// 存储对象的 Content-Type 解析 —— **远端对象存储不会像静态服务器那样按扩展名猜类型**。
//
// S3/R2/MinIO 的 PutObject 若不带 ContentType，对象一律落成 `binary/octet-stream`；
// 浏览器拿到的就是「下载」而不是「内联预览」（图片、PDF 最明显），
// 表现为「上传的图在站外直链点开就变成下载」。所以写入时必须显式带类型。
//
// 这里集中维护两件事，供 s3 / chevereto 驱动与上传管线共用，避免每个驱动各写一份映射：
//   1. 扩展名 → MIME（key 由 makeKey 生成、必带扩展名，是可靠的兜底来源）
//   2. 调用方声明的 MIME 能不能直接用（客户端传来的 file.type 不可信，见下）

/** 兜底类型：未知后缀一律按二进制流处理，浏览器行为 = 下载（安全且与修复前一致） */
export const FALLBACK_MIME = "application/octet-stream";

/**
 * 扩展名 → MIME（小写、不含点）。
 *
 * **故意不收录** html / htm / js / xml / svg 这类「可执行文档」后缀：
 * 公开访问基址（S3_PUBLIC_BASE / CDN 域名）若把用户上传物按 `text/html`、`image/svg+xml`
 * 回吐，存储域名就变成了存储型 XSS 的托管点。这些后缀继续落到 octet-stream → 强制下载。
 * 图片上传入口本身也只用 sniff 白名单（png/jpg/webp/gif），不依赖本表放行。
 */
const MIME_BY_EXT: Record<string, string> = {
  // 图片
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  apng: "image/apng",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
  heic: "image/heic",
  heif: "image/heif",
  // 音频
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  weba: "audio/webm",
  wma: "audio/x-ms-wma",
  // 视频
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  flv: "video/x-flv",
  wmv: "video/x-ms-wmv",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  ts: "video/mp2t",
  // 文档
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // 压缩包 / 光盘镜像
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  bz2: "application/x-bzip2",
  xz: "application/x-xz",
  iso: "application/x-iso9660-image",
  // 游戏 / 应用分发
  exe: "application/vnd.microsoft.portable-executable",
  apk: "application/vnd.android.package-archive",
  // 字体
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

/**
 * 明确拒绝作为公开对象 Content-Type 的类型 —— 客户端 `file.type` 可任意伪造，
 * 若原样写进对象存储，等于让攻击者把「存储域名」变成托管 HTML/JS 的地方。
 * 命中黑名单时退回按扩展名推断（本表不收录这些后缀，最终落成 octet-stream 强制下载）。
 */
const UNSAFE_DECLARED = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "application/ecmascript",
  "text/ecmascript",
  "application/x-shockwave-flash",
]);

/** MIME 形状校验（`type/subtype`，允许 `+`、`-`、`.` 等子类型字符） */
const MIME_SHAPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** 扩展名 → MIME；未收录返回 null（不猜） */
export function mimeFromExt(ext: string): string | null {
  const e = ext.replace(/^\./, "").trim().toLowerCase();
  return e ? (MIME_BY_EXT[e] ?? null) : null;
}

/**
 * 存储 key → MIME：取最后一段的扩展名（兼容 chevereto 那种完整 URL key，
 * 也容忍 `?query`/`#hash` 尾巴）；无法判定时返回 octet-stream。
 */
export function mimeFromKey(key: string): string {
  const last = key.split(/[?#]/)[0].split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot < 0) return FALLBACK_MIME;
  return mimeFromExt(last.slice(dot + 1)) ?? FALLBACK_MIME;
}

/**
 * 最终写入对象存储的 Content-Type：优先用调用方声明的类型（能表达扩展名说不清的类型，
 * 例如 `.jfif`、无后缀文件），但只接受形状合法且不在黑名单里的值；否则按 key 扩展名兜底。
 */
export function resolveContentType(declared: string | null | undefined, key: string): string {
  const d = (declared ?? "").split(";")[0].trim().toLowerCase();
  if (d && MIME_SHAPE.test(d) && !UNSAFE_DECLARED.has(d)) return d;
  return mimeFromKey(key);
}
