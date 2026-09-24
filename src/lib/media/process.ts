// 图片处理管线：由上传的原图生成 大图(压缩格式) + 缩略图(压缩格式) + LQIP 占位(data URI)。
// 原图逐字节保留（storageKey，供原图下载/归档）—— **唯一例外是加了水印**：像素被改写后必须重编码，
// 见下方 originalPipe 分支（GIF 例外，动图不加水印，否则会被压成静帧）。
// 生产环境可将本模块改为异步队列消费。
// 大图/缩略图的输出格式与质量取自后台上传限制配置（webp/jpg/png，见 media/compress.ts）。
//
// 并发约定：三次落盘不串行——原图上传与三次编码重叠，大图/缩略图并行落盘。
// 单次请求的墙钟时间决定了会不会被反代（Cloudflare 100s）掐成 524，
// 而远端驱动（chevereto/s3）下三次往返是这里最贵的一段，能重叠就重叠。
import sharp from "sharp";
import { makeKey, saveFile, publicUrl } from "@/lib/storage";
import {
  compressWith,
  encodeOriginal,
  outputExt,
  thumbQuality,
  type ImageCompressConfig,
} from "@/lib/media/compress";
import { applyWatermark, type WatermarkSpec } from "@/lib/media/watermark";

export type ProcessedImage = {
  storageKey: string; // local/s3: 相对 key；chevereto: 远端完整 URL
  bigKey: string | null; // 最长边 ≤1600 压缩图（灯箱）
  thumbKey: string | null; // 最长边 ≤480 压缩图（卡片封面）
  placeholder: string | null; // 16px PNG data URI（LQIP）
  width: number;
  height: number;
  size: number; // **落盘原图**的字节数：加水印重编码后与上传文件不再相同
  mime: string; // 原始文件 mime
  ext: string; // 原始扩展名（不含点）
};

/** 加水印时需要重编码原图的格式白名单。gif 不在其中：重编码丢帧，宁可不加水印 */
const WATERMARKABLE_ORIG_EXTS = new Set(["jpg", "png", "webp", "avif"]);

const EXT_BY_FORMAT: Record<string, string> = {
  jpeg: "jpg",
  jpg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
  avif: "avif",
};
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** 单阶段落盘并附带阶段上下文：失败时错误信息含「哪一步 + 底层原因」，便于日志快捷定位 */
async function saveStage(stage: string, key: string, buf: Buffer): Promise<string> {
  try {
    return await saveFile(key, buf);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`图片保存失败（${stage}）：${reason}`);
  }
}

export async function processImage(
  input: Buffer,
  cfg: ImageCompressConfig,
  watermark?: WatermarkSpec | null,
): Promise<ProcessedImage> {
  // makeKey 把 uuid 放在**文件名**上（`<dir>/<yyyymm>/<uuid><ext>`），所以这里必须把整串当目录用。
  // 原先 `slice(0, lastIndexOf("/"))` 会把 uuid 切掉、退化成 `images/<yyyymm>`：同一自然月的所有上传
  // 都写同一组 `original./big./thumb.`，而 local 与 s3 驱动都是「按 key 原样覆盖写」，
  // 于是第二张图会静默盖掉第一张（chevereto 只是因为远端给重名文件自动加了哈希后缀才看不出来）。
  const dir = makeKey("images", "");

  const oriented = sharp(input, { failOn: "none" }).rotate();
  const meta = await oriented.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const format = (meta.format ?? "png") as string;
  const origExt = EXT_BY_FORMAT[format] ?? "png";
  const mime = MIME_BY_EXT[origExt] ?? "image/png";
  // 压缩产物的扩展名随配置格式变化（存储驱动按 key 扩展名识别 content-type）
  const outExt = outputExt(cfg.format);

  // 水印：偏好（开没开、写什么）由调用点经 resolveWatermark() 解析后传入 —— 那里已经判过
  // 「站点字体能不能覆盖这段文字、要不要退到系统字体、环境支持不支持」。本层只保留一件
  // 只有自己知道的事：覆盖层在该尺寸下放不放得下。**这里不要再拦一道字体可用性**，
  // 否则轮廓模式（不依赖 fontconfig）会被误伤成「莫名其妙不打水印」。
  const wm = watermark ?? null;
  // big/thumb 都只缩不放，故目标宽度是精确值；高度按同比例取整，**仅**用于「放不放得下」的判断
  const bigW = Math.min(width, 1600);
  const thumbW = Math.min(width, 480);
  const scaledHeight = (w: number) => (width > 0 ? Math.round((height * w) / width) : height);

  // 原图默认**逐字节保留**（供原图下载/归档）。只有开了水印才改写它：像素已经变了，
  // 必须按**原始格式**重编码（不是 compressWith 的后台输出格式，否则扩展名/MIME/key 全对不上）。
  // 顺带丢掉 EXIF —— sharp 默认不保留元数据，水印场景下这正是想要的。
  // GIF 走原始字节：重编码会把动图压成静帧，宁可不加水印。
  const rewriteOriginal = wm !== null && WATERMARKABLE_ORIG_EXTS.has(origExt);
  const originalPipe = rewriteOriginal
    ? encodeOriginal(applyWatermark(oriented.clone(), wm, width, height), origExt)
    : null;

  let size = input.byteLength;
  // 三个对象的 key 只依赖目录与扩展名，先全部算出来，好让下面两批 Promise.all 不必互相等待
  const origKey = `${dir}/original.${origExt}`;
  const bigKey = `${dir}/big.${outExt}`;
  const thumbKey = `${dir}/thumb.${outExt}`;

  // 1) 原图落盘与「大图 / 缩略图 / LQIP 三次编码」并发。
  //    原图字节此刻已就绪，没必要等三次编码跑完才把它发出去：远端驱动（chevereto/s3）下
  //    这一次往返往往是整条链路里最贵的一段，让它与 CPU 编码重叠掉。
  //    改写原图时才分两步（编码 → 落盘），编码挂在 then 里，同样不挡住另外三个任务。
  const [storageKey, big, thumb, placeholderBuf] = await Promise.all([
    originalPipe
      ? originalPipe.toBuffer().then((buf) => {
          // size 的语义随水印从「上传文件」变成「落盘文件」，取真实写出的字节数
          size = buf.byteLength;
          return saveStage("原图", origKey, buf);
        })
      : saveStage("原图", origKey, input),
    compressWith(
      applyWatermark(
        oriented.clone().resize({ width: bigW, withoutEnlargement: true }),
        wm,
        bigW,
        scaledHeight(bigW),
      ),
      cfg,
    ).toBuffer(),
    // 缩略图质量比主图降一档
    compressWith(
      applyWatermark(
        oriented.clone().resize({ width: thumbW, withoutEnlargement: true }),
        wm,
        thumbW,
        scaledHeight(thumbW),
      ),
      { format: cfg.format, quality: thumbQuality(cfg.quality) },
    ).toBuffer(),
    // LQIP 不加印：16px 宽，文字只会变成一团噪点
    oriented
      .clone()
      .resize({ width: 16, height: 16, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer(),
  ]);

  // 2) 大图与缩略图彼此独立，并发落盘：把两次串行往返压成一次等待。
  //    单请求墙钟时间直接决定会不会被反代（Cloudflare 100s）掐成 524，这里是主要可压的一段。
  const [bigUrl, thumbUrl] = await Promise.all([
    saveStage("大图", bigKey, big),
    saveStage("缩略图", thumbKey, thumb),
  ]);

  // 3) LQIP
  const placeholder = `data:image/png;base64,${placeholderBuf.toString("base64")}`;

  // storageKey/bigKey/thumbKey：chevereto 存 URL，其余存 key（publicUrl 两者都兼容）
  return {
    storageKey,
    bigKey: bigUrl,
    thumbKey: thumbUrl,
    placeholder,
    width,
    height,
    size,
    mime,
    ext: origExt,
  };
}

export { publicUrl };
