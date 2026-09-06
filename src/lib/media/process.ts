// 图片处理管线：由上传的原图生成 大图(webp) + 缩略图(webp) + LQIP 占位(data URI)。
// 原图逐字节保留（storageKey，供原图下载/归档）。生产环境可将本模块改为异步队列消费。
import sharp from "sharp";
import { makeKey, saveFile, publicUrl } from "@/lib/storage";

export type ProcessedImage = {
  storageKey: string; // local/s3: 相对 key；chevereto: 远端完整 URL
  bigKey: string | null; // 最长边 ≤1600 webp（灯箱）
  thumbKey: string | null; // 最长边 ≤480 webp（卡片封面）
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

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const base = makeKey("images", ".x"); // 仅借用唯一目录
  const dir = base.slice(0, base.lastIndexOf("/"));

  const oriented = sharp(input, { failOn: "none" }).rotate();
  const meta = await oriented.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const format = (meta.format ?? "png") as string;
  const ext = EXT_BY_FORMAT[format] ?? "png";
  const mime = MIME_BY_EXT[ext] ?? "image/png";

  // 1) 原图逐字节保存（chevereto 驱动下 saveFile 返回远端 URL，落库即 URL）
  const origKey = `${dir}/original.${ext}`;
  const storageKey = await saveFile(origKey, input);
  const size = input.byteLength;

  // 2) 大图
  const bigKey = `${dir}/big.webp`;
  const big = await oriented
    .clone()
    .resize({ width: Math.min(width, 1600), withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const bigUrl = await saveFile(bigKey, big);

  // 3) 缩略图
  const thumbKey = `${dir}/thumb.webp`;
  const thumb = await oriented
    .clone()
    .resize({ width: Math.min(width, 480), withoutEnlargement: true })
    .webp({ quality: 74 })
    .toBuffer();
  const thumbUrl = await saveFile(thumbKey, thumb);

  // 4) LQIP
  const placeholderBuf = await oriented
    .clone()
    .resize({ width: 16, height: 16, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
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
    ext,
  };
}

export { publicUrl };
