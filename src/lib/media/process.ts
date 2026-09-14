// 图片处理管线：由上传的原图生成 大图(压缩格式) + 缩略图(压缩格式) + LQIP 占位(data URI)。
// 原图逐字节保留（storageKey，供原图下载/归档）。生产环境可将本模块改为异步队列消费。
// 大图/缩略图的输出格式与质量取自后台上传限制配置（webp/jpg/png，见 media/compress.ts）。
//
// 并发约定：三次落盘不串行——原图上传与三次编码重叠，大图/缩略图并行落盘。
// 单次请求的墙钟时间决定了会不会被反代（Cloudflare 100s）掐成 524，
// 而远端驱动（chevereto/s3）下三次往返是这里最贵的一段，能重叠就重叠。
import sharp from "sharp";
import { makeKey, saveFile, publicUrl } from "@/lib/storage";
import {
  compressWith,
  outputExt,
  thumbQuality,
  type ImageCompressConfig,
} from "@/lib/media/compress";

export type ProcessedImage = {
  storageKey: string; // local/s3: 相对 key；chevereto: 远端完整 URL
  bigKey: string | null; // 最长边 ≤1600 压缩图（灯箱）
  thumbKey: string | null; // 最长边 ≤480 压缩图（卡片封面）
  placeholder: string | null; // 16px PNG data URI（LQIP）
  width: number;
  height: number;
  size: number;
  mime: string; // 原始文件 mime
  ext: string; // 原始扩展名（不含点）
};

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
): Promise<ProcessedImage> {
  const base = makeKey("images", ".x"); // 仅借用唯一目录
  const dir = base.slice(0, base.lastIndexOf("/"));

  const oriented = sharp(input, { failOn: "none" }).rotate();
  const meta = await oriented.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const format = (meta.format ?? "png") as string;
  const origExt = EXT_BY_FORMAT[format] ?? "png";
  const mime = MIME_BY_EXT[origExt] ?? "image/png";
  // 压缩产物的扩展名随配置格式变化（存储驱动按 key 扩展名识别 content-type）
  const outExt = outputExt(cfg.format);

  const size = input.byteLength;
  // 三个对象的 key 只依赖目录与扩展名，先全部算出来，好让下面两批 Promise.all 不必互相等待
  const origKey = `${dir}/original.${origExt}`;
  const bigKey = `${dir}/big.${outExt}`;
  const thumbKey = `${dir}/thumb.${outExt}`;

  // 1) 原图落盘与「大图 / 缩略图 / LQIP 三次编码」并发。
  //    原图字节此刻已就绪，没必要等三次编码跑完才把它发出去：远端驱动（chevereto/s3）下
  //    这一次往返往往是整条链路里最贵的一段，让它与 CPU 编码重叠掉。
  const [storageKey, big, thumb, placeholderBuf] = await Promise.all([
    saveStage("原图", origKey, input),
    compressWith(
      oriented.clone().resize({ width: Math.min(width, 1600), withoutEnlargement: true }),
      cfg,
    ).toBuffer(),
    // 缩略图质量比主图降一档
    compressWith(
      oriented.clone().resize({ width: Math.min(width, 480), withoutEnlargement: true }),
      { format: cfg.format, quality: thumbQuality(cfg.quality) },
    ).toBuffer(),
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
