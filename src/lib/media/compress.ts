// 上传压缩统一出口：把后台配置的「输出格式 + 质量」翻译为 sharp 编码器。
// 全站所有服务端图片压缩点（图集大图/缩略图、评论附图、头像、主页横幅）都走这里，规则只维护一份。
//
// alpha 通道约定（重要）：
// - webp：alphaQuality 独立于主质量并锁定 100，有损压缩不会劣化透明通道；
// - png ：quality<100 走调色板量化（palette 显式带 alpha 支持），quality=100 走无损，两者都保留透明；
// - jpg ：格式本身无 alpha，必须先 flatten 合成底色再编码，否则透明像素会被写成黑色。
import sharp from "sharp";
import {
  QUALITY_RANGE,
  OUT_EXT_BY_FORMAT,
  OUT_MIME_BY_FORMAT,
  DEFAULT_IMAGE_FORMAT,
  DEFAULT_IMAGE_QUALITY,
  type ImageOutputFormat,
} from "@/lib/upload-config";

/** sharp 管道实例类型（sharp 用 export = 导出，无法直接取命名类型） */
type SharpPipe = ReturnType<typeof sharp>;

/** jpg 合成底色：与站点暖白一致的纯白，避免透明区域变黑 */
const JPEG_FLATTEN_BG = "#ffffff";

/** 缩略图相对主图降一档质量（默认 82 → 74，与迁移前后台硬编码值一致） */
const THUMB_QUALITY_DROP = 8;
const MIN_THUMB_QUALITY = 40;

/** 压缩参数：由 UploadLimits 的 imageFormat / imageQuality 派生 */
export type ImageCompressConfig = {
  format: ImageOutputFormat;
  quality: number;
};

export const DEFAULT_COMPRESS_CONFIG: ImageCompressConfig = {
  format: DEFAULT_IMAGE_FORMAT,
  quality: DEFAULT_IMAGE_QUALITY,
};

/** 由完整上传限制里取出压缩参数 */
export function compressConfigOf(l: {
  imageFormat: ImageOutputFormat;
  imageQuality: number;
}): ImageCompressConfig {
  return { format: l.imageFormat, quality: l.imageQuality };
}

/** 输出扩展名（不含点）：存储 key 依赖它识别类型 */
export const outputExt = (format: ImageOutputFormat) => OUT_EXT_BY_FORMAT[format];
/** 输出 MIME：落库 media.mime 用 */
export const outputMime = (format: ImageOutputFormat) => OUT_MIME_BY_FORMAT[format];

/** 缩略图质量：主图降一档，避免小图沿用高质量档位白白增大体积 */
export function thumbQuality(quality: number): number {
  return Math.max(MIN_THUMB_QUALITY, quality - THUMB_QUALITY_DROP);
}

/**
 * 按配置编码：传入已 resize 的 sharp 实例，返回编码后的实例（调用方自行 toBuffer）。
 * 所有分支都不主动丢弃 alpha，除非目标格式（jpg）本身不支持。
 */
export function compressWith(pipe: SharpPipe, cfg: ImageCompressConfig): SharpPipe {
  const quality = Math.min(QUALITY_RANGE.max, Math.max(QUALITY_RANGE.min, Math.round(cfg.quality)));
  switch (cfg.format) {
    case "jpg":
      // 无 alpha 通道：先合成白底，再把 alpha 通道丢掉
      return pipe.flatten({ background: JPEG_FLATTEN_BG }).jpeg({ quality, mozjpeg: true });
    case "png":
      // quality=100 = 无损；否则调色板量化（palette 带 alpha 透明度支持）
      return quality >= QUALITY_RANGE.max
        ? pipe.png({ compressionLevel: 9 })
        : pipe.png({ palette: true, quality, compressionLevel: 9, effort: 7 });
    default:
      return pipe.webp({ quality, alphaQuality: 100 });
  }
}
