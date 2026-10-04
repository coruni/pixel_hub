// 前端上传前预压缩：**浏览器里先把 10MB+ 的原图压一遍**（重编码 + 按需降采样），
// 再交给 /api/upload（图集 / 文章插图 / 编辑器内联图）或评论附图通道走服务端管线。目的：
//
// 1) 砍掉上传体积 —— 网络耗时、反代（Cloudflare 100s）的 524 预算、服务端 sharp 解码压力都随之下降；
// 2) 顺手丢掉 EXIF/ICC 等元信息（隐私 + 体积）；
// 3) 服务端照常做「原图 + 大图 + 缩略图 + 水印」那套处理，这里只是把输入前置压小，不改语义。
//
// 去重指纹口径保持不变：**压缩前**原始字节的 sha256。前端能拿到「真正的源字节」，所以指纹改在
// 这里算（crypto.subtle.digest），随压缩产物一起发给服务端；服务端收到带合法指纹的请求就用它，
// 收不到再回退「对收到字节取 sha256」（见路由 / 评论 action）。这样老记录（指纹 = 原图 sha256）
// 与新上传依然能对上，跨版本去重不失效。
//
// 透明通道：PixelHub 是像素风资源站，PNG 透明图是常态，**必须保留**。
// webp 输出原生带 alpha；个别老浏览器编码不了 webp 时，源是 png/webp/avif 的退回 png（保透明），
// 源是 jpeg（本就无透明）的退回 jpeg。极端情况下（webp/png 都不可用且源带透明）退回 jpeg 前先铺白底，
// 避免透明像素变黑边。gif 不动（canvas 只能取首帧，压了会丢动画）。

export type CompressedImage = {
  /** 压缩后的文件；若判定没必要压（太小 / gif / 解码失败 / 没压小），则返回原文件 */
  file: File;
  /** 压缩前原始字节的 sha256（十六进制小写）；非安全上下文拿不到时为空串，由服务端回退计算 */
  originalChecksum: string;
  /** 原始像素宽高（解码失败时为 0） */
  width: number;
  height: number;
  /** 本轮是否真的重新编码过（false 表示直接用了原文件） */
  wasCompressed: boolean;
};

/** 超过则等比降到该边长以内：挡住 100MP 手机照把服务端压垮，正常照片保持原分辨率（原图归档语义不变） */
const MAX_SIDE = 4096;
/** 已小于此值且无需降采样时不压：省 CPU，且小图重编码可能反而变大 */
const MIN_BYTES = 200 * 1024;
/** 有损档：前端只是「预压缩」，服务端还会按后台配置再编码一次，0.85 足够且肉眼无差 */
const QUALITY = 0.85;

/** 源格式是否可能带透明通道（决定 webp 不可用时的退回策略） */
function hasAlphaSource(type: string): boolean {
  return type === "image/png" || type === "image/webp" || type === "image/avif";
}

/** 压缩前源字节的 sha256；非安全上下文（非 localhost / https）下 crypto.subtle 不存在，返回空串 */
async function sha256HexOf(buf: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle ?? null;
  if (!subtle) return "";
  const hex = await subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hex))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** 把 canvas 编码成尽量小且保透明的 blob：优先 webp，必要时退回 png / jpeg */
async function encodeBest(canvas: HTMLCanvasElement, alpha: boolean): Promise<Blob> {
  const webp = await canvasToBlob(canvas, "image/webp", QUALITY);
  if (webp && webp.type === "image/webp" && webp.size > 0) return webp;
  if (alpha) {
    const png = await canvasToBlob(canvas, "image/png");
    if (png && png.size > 0) return png;
  }
  // jpeg 无 alpha：若源带透明，先铺白底避免黑边，再编码
  if (alpha) {
    const bg = document.createElement("canvas");
    bg.width = canvas.width;
    bg.height = canvas.height;
    const ctx = bg.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, bg.width, bg.height);
      ctx.drawImage(canvas, 0, 0);
      const j = await canvasToBlob(bg, "image/jpeg", QUALITY);
      if (j && j.size > 0) return j;
    }
  }
  const jpg = await canvasToBlob(canvas, "image/jpeg", QUALITY);
  if (jpg && jpg.size > 0) return jpg;
  throw new Error("图片编码失败");
}

/** 压缩失败时回退到原文件（仍带上已算出的指纹） */
function asOriginal(file: File, originalChecksum: string, w = 0, h = 0): CompressedImage {
  return { file, originalChecksum, width: w, height: h, wasCompressed: false };
}

/**
 * 单张图片上传前预压缩。任何异常都降级为「原文件 + 指纹」，保证上传主链路不被压图逻辑拖垮。
 */
export async function compressImageForUpload(file: File): Promise<CompressedImage> {
  let originalChecksum = "";
  try {
    const buf = await file.arrayBuffer();
    originalChecksum = await sha256HexOf(buf);
    // 小文件且不触发降采样：直接回原文件（指纹已算好，去重不丢）
    if (file.size <= MIN_BYTES) return asOriginal(file, originalChecksum);
  } catch {
    return asOriginal(file, "");
  }

  // gif 不压：canvas 只能取首帧，压了会丢动画（服务端也按原字节保留 gif 原图）
  if (file.type === "image/gif") return asOriginal(file, originalChecksum);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return asOriginal(file, originalChecksum);
  }
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    if (!w || !h) return asOriginal(file, originalChecksum, w, h);
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) return asOriginal(file, originalChecksum, w, h);
    ctx.drawImage(bitmap, 0, 0, tw, th);
    const alpha = hasAlphaSource(file.type);
    const blob = await encodeBest(canvas, alpha);
    bitmap.close();
    // 没压小（已高度优化 / 源就是 webp）：用原文件，避免反而变大
    if (blob.size >= file.size) return asOriginal(file, originalChecksum, w, h);
    // 新文件名：保留原名主体，扩展名随真实输出类型
    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
    const base = (file.name || "image").replace(/\.[^.]+$/, "");
    const outName = `${base}.${ext}`;
    const outFile = new File([blob], outName, { type: blob.type });
    return { file: outFile, originalChecksum, width: w, height: h, wasCompressed: true };
  } catch {
    bitmap.close();
    return asOriginal(file, originalChecksum);
  }
}

/** 批量预压缩（调用点可在外层控制并发，这里只负责逐张转换） */
export async function compressImagesForUpload(files: File[]): Promise<CompressedImage[]> {
  return Promise.all(files.map((f) => compressImageForUpload(f)));
}
