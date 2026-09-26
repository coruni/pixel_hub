// 上传限制配置 —— 纯数据/校验层（不依赖 server，可被前后端与 seed 共用）。
// 文档存于 SiteSetting["uploadLimits"]（JSON 文本），带 version 乐观锁（读写见 upload-limits.ts）。
// 结构：
// {
//   attachmentMaxMb,        // 附件单文件上限 MB（1..256000；256000 = OneDrive 250GiB）
//   attachmentExts,         // 附件允许后缀（全小写不带点，命中 DENY_EXTS 一律拒绝）
//   galleryImageMaxMb,      // 图集/原图单张 + 后台直传（1..100）
//   commentImageMaxMb,      // 评论附图单张（1..100）
//   avatarMaxMb,            // 头像（1..100）
//   heroImageMaxMb,         // 主页横幅单张（1..100）
//   profileBgMaxMb,         // 个人主页背景单张（1..100；仅桌面端渲染）
//   galleryImageMaxCount,   // 图集/原图张数上限（只设下界 1，上不封顶）
//   commentImageMaxCount,   // 评论附图张数上限
//   imageFormat,            // 服务端压缩输出格式 webp|jpg|png（webp/png 保留 alpha）
//   imageQuality,           // 服务端压缩质量（1..100）
// }
//
// 服务端各上传路由/action 每次请求读一次配置并**以此为准**强制执行；
// 缺失/坏数据经 parseUploadLimits 回退代码内默认，绝不抛错（与 theme 一致）。

export const UPLOAD_LIMITS_KEY = "uploadLimits";

export const MIB = 1024 * 1024;

/** OneDrive 单文件上限：250GiB，配置字段以 MiB 存储。 */
export const MAX_ATTACHMENT_MB = 250 * 1024;

// ---------- OneDrive Graph 分片参数（前后端共用，避免两处各写一个数） ----------

/**
 * Graph 对 upload session 分片的硬约束：每个 byte range 必须是 320 KiB 的整数倍。
 * 不整除不会当场报错，而是**传完最后一片才失败**——大文件传到底才炸，排查成本极高，
 * 所以分片大小一律经 snapChunkBytes 收口，不手写裸字节数。
 */
export const GRAPH_CHUNK_MULTIPLE = 320 * 1024;

/** 分片上限：Graph 要求单请求体 < 60 MiB，取 40 MiB（= 128 × 320 KiB）留出余量 */
export const GRAPH_CHUNK_MAX = 40 * MIB;

/** 分片下限：5 MiB（= 16 × 320 KiB）。弱网下更小的分片重传成本更低 */
export const GRAPH_CHUNK_MIN = 5 * MIB;

/**
 * 默认分片 40 MiB（= 128 × 320 KiB）。
 * 取舍：分片越大往返次数越少（2GiB 从 205 片降到 52 片，10GiB 从 1024 片降到 256 片），
 * 但单片失败要重传的字节也越多。官方文档在稳定高速链路下推荐 10 MiB；
 * 若站点用户多在弱网，把它调回 10 * MIB 即可，客户端会原样跟随服务端下发的值。
 */
export const GRAPH_CHUNK_BYTES = 40 * MIB;

/**
 * 把任意字节数收敛到 [GRAPH_CHUNK_MIN, GRAPH_CHUNK_MAX] 内的 320 KiB 整数倍。
 * 用于兜住服务端下发的（可能是旧版本或误配的）分片值——不合规的分片会让整次上传白跑。
 */
export function snapChunkBytes(bytes: unknown): number {
  const n = typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0;
  const steps = Math.floor(n / GRAPH_CHUNK_MULTIPLE);
  const minSteps = GRAPH_CHUNK_MIN / GRAPH_CHUNK_MULTIPLE;
  const maxSteps = GRAPH_CHUNK_MAX / GRAPH_CHUNK_MULTIPLE;
  return Math.min(maxSteps, Math.max(minSteps, steps)) * GRAPH_CHUNK_MULTIPLE;
}

/** 附件后缀：≤200 项、每项 ^[a-z0-9]{1,10}$（全小写、不带点） */
export const MAX_EXT_COUNT = 200;
export const EXT_TOKEN_RE = /^[a-z0-9]{1,10}$/;

/** 数值范围：附件上限受 OneDrive Graph 单文件 250GiB 约束；图片类另设档位 */
export const MB_RANGE = {
  attachment: { min: 1, max: MAX_ATTACHMENT_MB },
  image: { min: 1, max: 100 },
} as const;

/**
 * 单批次/单资源图片数量上限（张）：图集 / 文章插图共用此档位。
 * 只设下界、**不设上界**——原先 `max: 60` 的硬编码天花板会让后台无法配置更大的批量，
 * 已去掉（站点是管理员自己的，张数由其按需决定；真被滥用由上传限流兜底）。
 */
export const COUNT_RANGE = { min: 1 } as const;
/** 评论附图数量上限范围（张）：单条评论附图，保留 0..20 的窄档位（0 = 禁止附图） */
export const COMMENT_COUNT_RANGE = { min: 0, max: 20 } as const;

/**
 * 主页背景解锁判定。**门槛 0 = 不限**；激励总开关关掉时等级不存在，门槛随之失效（否则会给
 * 全员上锁且无任何提升途径）。门槛值来自激励配置的 `profile.bgMinLevel`（等级序号，0 起）。
 * 前台渲染与设置页表单必须共用这一个函数，避免两头口径漂移。
 */
export function profileBgUnlocked(level: number, minLevel: number, incentiveEnabled = true): boolean {
  if (!incentiveEnabled) return true;
  return minLevel <= 0 || level >= minLevel;
}

/**
 * 主页背景遮罩的默认值（mask-image 的完整值）。
 *
 * 背景层铺满视口、固定在最底层，**中段必须完全透明**，否则会压到正文卡片下面。
 * 这条 mask 决定的就是「左右两条可见带」的形状：贴屏幕边缘最清晰，向屏幕中间淡出到 0。
 *
 * 【必须与 globals.css 的 `.profile-bg-pc` 保持一致】那边把它声明成 `--profile-bg-mask` 的默认值，
 * 用途是「用户没自定义 / 自定义值被清掉」时兜底。这里同时是设置页的 placeholder 与
 * 「恢复默认」的目标值 —— 改一处必须同步改另一处。
 */
export const PROFILE_BG_MASK_DEFAULT =
  "linear-gradient(to right, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 1) 6%, rgba(0, 0, 0, 0.55) 14%, rgba(0, 0, 0, 0) 24%, rgba(0, 0, 0, 0) 76%, rgba(0, 0, 0, 0.55) 86%, rgba(0, 0, 0, 1) 94%, rgba(0, 0, 0, 1) 100%)";

/** 遮罩值长度上限（只做防呆；默认值约 250 字符，正常改法不会接近它） */
export const PROFILE_BG_MASK_MAX = 600;

/**
 * 遮罩值形状校验：不合格一律返回内置默认遮罩（**不抛错、也不返回 null**）。
 *
 * 为什么渲染前还要判一次：用户可能填进带 url() 的值，库里也可能躺着旧版本的脏值 ——
 * 渲染点不能因此崩掉、更不能漏出外部请求，所以一律经这道收口。
 *
 * 只放行渐变写法（字母/数字/空格/.,%()#_-），挡掉 url() / image-set() / var() / @ / ; / { } / < >：
 * 前者能发起外部请求，后者是注入面。遮罩是纯装饰，不需要这些能力。
 */
export function safeBgMask(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v || v.length > PROFILE_BG_MASK_MAX) return PROFILE_BG_MASK_DEFAULT;
  if (!/^(repeating-)?(linear|radial|conic)-gradient\(/i.test(v)) return PROFILE_BG_MASK_DEFAULT;
  if (!v.endsWith(")")) return PROFILE_BG_MASK_DEFAULT;
  if (/var\(/i.test(v)) return PROFILE_BG_MASK_DEFAULT;
  if (!/^[a-zA-Z0-9\s.,%()#_-]+$/.test(v)) return PROFILE_BG_MASK_DEFAULT;
  return v;
}

/**
 * 用户填的遮罩值能不能存（空串 = 用默认，也算合法）。
 * 与 safeBgMask 是同一个判定的两种用法：渲染要拿到「实际该用的值」，表单只要「合不合法」。
 */
export function isValidBgMask(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim();
  return v === "" || safeBgMask(v) === v;
}

/**
 * 水印文字长度上限。放在这里而不是 media/watermark.ts：设置页的表单是客户端组件，
 * 而 media/watermark.ts 依赖 sharp，客户端一旦 import 就会把原生模块拖进 bundle。
 */
export const WATERMARK_TEXT_MAX = 40;

/**
 * 水印落点。取值与 Prisma 的 WatermarkPosition 枚举逐字一致（大写），
 * 表单直接把它当 radio 的 value 提交，省掉一层大小写转换。
 * 顺序 = 设置页里的展示顺序（四角按左上→右上→左下→右下，最后是全屏）。
 */
export const WATERMARK_POSITIONS = [
  "TOP_LEFT",
  "TOP_RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM_RIGHT",
  "TILE",
] as const;
export type WatermarkPositionValue = (typeof WATERMARK_POSITIONS)[number];

/** 压缩输出格式：webp（默认，体积最优）/ jpg（兼容性最好，无透明）/ png（无损或调色板量化） */
export const IMAGE_FORMATS = ["webp", "jpg", "png"] as const;
export type ImageOutputFormat = (typeof IMAGE_FORMATS)[number];

/** 压缩质量范围：webp/jpg 为有损档位；png 为调色板量化档位，100 = 无损 */
export const QUALITY_RANGE = { min: 1, max: 100 } as const;

export const DEFAULT_IMAGE_FORMAT: ImageOutputFormat = "webp";
export const DEFAULT_IMAGE_QUALITY = 82;

/**
 * 输出格式 → 落盘扩展名 / MIME。
 * 存储驱动（chevereto/local/onedrive）按 key 的扩展名识别 content-type，key 必须与实际字节一致。
 */
export const OUT_EXT_BY_FORMAT: Record<ImageOutputFormat, string> = {
  webp: "webp",
  jpg: "jpg",
  png: "png",
};
export const OUT_MIME_BY_FORMAT: Record<ImageOutputFormat, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  png: "image/png",
};

/** 该格式是否带 alpha 透明通道（jpg 不支持，透明区域需先合成底色） */
export const FORMAT_HAS_ALPHA: Record<ImageOutputFormat, boolean> = {
  webp: true,
  jpg: false,
  png: true,
};

export function isImageFormat(v: unknown): v is ImageOutputFormat {
  return typeof v === "string" && (IMAGE_FORMATS as readonly string[]).includes(v);
}

/**
 * 硬拒后缀：即使管理员手滑加入也不允许。被本站以可执行/脚本型 content-type 同源托管会有
 * 存储型 XSS / 下载执行风险（html/svg/xml 内嵌脚本、js/wasm/swf 可直接执行、exe/msi 等诱骗下载）。
 */
export const DENY_EXTS: ReadonlySet<string> = new Set([
  "html",
  "htm",
  "shtml",
  "xhtml",
  "svg",
  "js",
  "mjs",
  "cjs",
  "ts",
  "jsx",
  "tsx",
  "css",
  "xml",
  "xsd",
  "xsl",
  "wasm",
  "swf",
  "exe",
  "msi",
  "com",
  "bat",
  "cmd",
  "sh",
  "bash",
  "ps1",
  "vbs",
  "jar",
  "py",
  "php",
  "phtml",
  "jsp",
  "asp",
  "aspx",
  "cgi",
  "dll",
  "scr",
  "hta",
]);

export type UploadLimits = {
  attachmentMaxMb: number;
  attachmentExts: string[];
  galleryImageMaxMb: number;
  commentImageMaxMb: number;
  avatarMaxMb: number;
  /** 主页横幅（个人主页 hero，16:5 裁剪为 1600×500）：单张上限 */
  heroImageMaxMb: number;
  /** 个人主页背景（仅桌面端渲染）：单张上限（1..100） */
  profileBgMaxMb: number;
  /** 图集 / 原图：单个资源可上传的图片张数上限（IMAGE 类型预览图）；只设下界，无上界 */
  galleryImageMaxCount: number;
  /** 评论附图：单条评论可附带的图片张数上限 */
  commentImageMaxCount: number;
  /** 服务端压缩输出格式（webp / jpg / png） */
  imageFormat: ImageOutputFormat;
  /** 服务端压缩质量（1..100） */
  imageQuality: number;
};

/** 文章媒体固定为 1 张封面，其余插图放正文（编辑器内上传），不做后台配置 */
export const ARTICLE_MEDIA_MAX = 1;

/** 音乐 / 视频同样固定 1 张封面：卡片与详情页只需要一张主视觉，其余图放正文 */
export const AV_COVER_MAX = 1;

/** 只允许一张封面的类型（游戏 / 文章 / 音乐 / 视频）——发布与改稿共用同一判定，避免两处漂移 */
export const SINGLE_COVER_TYPES: readonly string[] = ["GAME", "ARTICLE", "MUSIC", "VIDEO"];

export function isSingleCoverType(type: string): boolean {
  return SINGLE_COVER_TYPES.includes(type);
}

/** 默认 = 今日各处硬编码值原样迁入（附件 200MB + 29 后缀；图集 20；评论图 5；头像 5；主页横幅 20） */
export const DEFAULT_ATTACH_EXTS: readonly string[] = [
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
  "pdf",
  "md",
  "txt",
  "epub",
  "mobi",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "mp4",
  "webm",
  "mkv",
  "obj",
  "fbx",
  "blend",
  "aseprite",
  "godot",
  "unitypackage",
  "ttf",
  "otf",
  "woff",
  "woff2",
];

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  attachmentMaxMb: 200,
  attachmentExts: [...DEFAULT_ATTACH_EXTS],
  galleryImageMaxMb: 20,
  commentImageMaxMb: 5,
  avatarMaxMb: 5,
  heroImageMaxMb: 20,
  profileBgMaxMb: 20,
  galleryImageMaxCount: 12,
  commentImageMaxCount: 3,
  imageFormat: DEFAULT_IMAGE_FORMAT,
  imageQuality: DEFAULT_IMAGE_QUALITY,
};

// ---------- 数值 / 后缀校验（纯函数） ----------

export function clampInt(n: unknown, min: number, max: number, dflt: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * 只保留下界的整数钳制：给**已去掉上界**的字段用（当前只有图集张数上限）。
 * 用 clampInt 会重新引入天花板，故单列一个函数把「无上界」这件事写在类型/命名上。
 */
export function clampIntMin(n: unknown, min: number, dflt: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return dflt;
  return Math.max(min, Math.round(n));
}

/** 宽松清洗（读库兜底用）：逐 token 去点小写去重，非法/命中 DENY 一律剔除；返回 [] 表示全废 */
export function cleanExts(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const t of v) {
    const s = typeof t === "string" ? t.trim().toLowerCase().replace(/^\.+/, "") : "";
    if (!s || !EXT_TOKEN_RE.test(s) || DENY_EXTS.has(s)) continue;
    out.add(s);
  }
  return [...out];
}

/** 严格校验（管理员保存用）：任一非法/被拒 token 即整单报错并指出问题项 */
export function normalizeExts(
  raw: string,
): { ok: true; list: string[] } | { ok: false; error: string } {
  const tokens = (raw ?? "")
    .split(/[\s,，;、]+/)
    .map((t) => t.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
  if (tokens.length === 0) return { ok: false, error: "至少保留一个允许后缀" };
  if (tokens.length > MAX_EXT_COUNT)
    return { ok: false, error: `后缀过多（≤${MAX_EXT_COUNT} 项）` };
  const seen = new Set<string>();
  for (const t of tokens) {
    if (!EXT_TOKEN_RE.test(t))
      return { ok: false, error: `后缀 ${t} 不合法：仅小写字母/数字，1–10 位，不带点` };
    if (DENY_EXTS.has(t))
      return { ok: false, error: `后缀 ${t} 被安全策略禁止（可执行/脚本型，防存储型 XSS）` };
    seen.add(t);
  }
  return { ok: true, list: [...seen].sort() };
}

/** 从 SiteSetting JSON 解析为完整 UploadLimits（null/坏数据字段级兜底，绝不抛错） */
export function parseUploadLimits(raw: unknown): UploadLimits {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const exts = cleanExts(o.attachmentExts);
  return {
    attachmentMaxMb: clampInt(
      o.attachmentMaxMb,
      MB_RANGE.attachment.min,
      MB_RANGE.attachment.max,
      200,
    ),
    attachmentExts: exts.length > 0 ? exts : [...DEFAULT_ATTACH_EXTS],
    galleryImageMaxMb: clampInt(o.galleryImageMaxMb, MB_RANGE.image.min, MB_RANGE.image.max, 20),
    commentImageMaxMb: clampInt(o.commentImageMaxMb, MB_RANGE.image.min, MB_RANGE.image.max, 5),
    avatarMaxMb: clampInt(o.avatarMaxMb, MB_RANGE.image.min, MB_RANGE.image.max, 5),
    // 横幅：缺失回退站点默认（与改造前 avatarMaxMb × 4 的实际效果一致，避免老配置行为跳变）
    heroImageMaxMb: clampInt(
      o.heroImageMaxMb,
      MB_RANGE.image.min,
      MB_RANGE.image.max,
      DEFAULT_UPLOAD_LIMITS.heroImageMaxMb,
    ),
    // 图集张数：只钳下界，大值原样保留（原先的 max 60 天花板已去掉）
    galleryImageMaxCount: clampIntMin(o.galleryImageMaxCount, COUNT_RANGE.min, 12),
    profileBgMaxMb: clampInt(
      o.profileBgMaxMb,
      MB_RANGE.image.min,
      MB_RANGE.image.max,
      DEFAULT_UPLOAD_LIMITS.profileBgMaxMb,
    ),
    commentImageMaxCount: clampInt(
      o.commentImageMaxCount,
      COMMENT_COUNT_RANGE.min,
      COMMENT_COUNT_RANGE.max,
      3,
    ),
    imageFormat: isImageFormat(o.imageFormat) ? o.imageFormat : DEFAULT_IMAGE_FORMAT,
    imageQuality: clampInt(
      o.imageQuality,
      QUALITY_RANGE.min,
      QUALITY_RANGE.max,
      DEFAULT_IMAGE_QUALITY,
    ),
  };
}

export function serializeUploadLimits(l: UploadLimits): string {
  return JSON.stringify(l);
}

// ---------- 客户端提示格式化（纯函数，供 wizard/version 等 client 组件 import） ----------

/** `<input accept>`：后缀表 → ".zip,.rar,…" */
export function attachmentAcceptAttr(exts: string[]): string {
  return exts.map((e) => `.${e}`).join(",");
}

/** 提示里展示的后缀样例：超过 n 项截断为“…等” */
export function attachmentExtsSample(exts: string[], n = 5): string {
  const head = exts.slice(0, n).join("/");
  return exts.length > n ? `${head} 等` : head;
}

// ---------- 体积文本与单位换算（纯函数，后台表单与前台提示共用） ----------

export const MB_PER_GB = 1024;
/**
 * 切 GB 的对齐粒度：半个 GB。
 * 取 512 而不是 1024，是为了让 1.5GB / 2.5GB 这类值也能用 GB 干净地表达；
 * 同时天然排除 1500MB（= 1.46484375GB）这类除不尽的档位。
 */
const GB_ALIGN_MB = MB_PER_GB / 2;

/**
 * MB 数值 → 可读体积文本。
 *
 * 【为什么不是 `mb/1024` 直接换算】1500MB / 1024 = 1.46484375GB —— 后台只要填一个非整 GB 的数，
 * 界面就会出现一长串小数（「有零有整」），跟前端提示也对不上。
 * 规则：能整除成 1GB / 1.5GB 这类干净值时才切 GB，否则原样显示 MB，
 * 保证「填什么、到哪都显示什么」。
 */
export function sizeText(mb: number): string {
  if (!Number.isFinite(mb)) return "—";
  if (mb >= MB_PER_GB && mb % GB_ALIGN_MB === 0) return `${mb / MB_PER_GB}GB`;
  return `${mb}MB`;
}

/** “≤200MB” / “≤2GB” 式体积提示（发布向导、附件上传的提示行共用） */
export function mbText(mb: number): string {
  return `≤${sizeText(mb)}`;
}

/** 体积输入单位：MB / GB。存储一律是整数 MB，单位只影响输入与展示 */
export const SIZE_UNITS = ["MB", "GB"] as const;
export type SizeUnit = (typeof SIZE_UNITS)[number];

/** 表单值 + 单位 → 存储用的整数 MB（服务端 save 时仍会 clamp 一次） */
export function toMb(value: number, unit: SizeUnit): number {
  const n = Number.isFinite(value) ? value : 0;
  return Math.round(unit === "GB" ? n * MB_PER_GB : n);
}

/**
 * 存储值 → 表单的「数值 + 单位」，与 sizeText 用**同一条规则**，
 * 保证输入框、概览卡、前台提示三处永远说的是同一个数。
 */
export function fromMb(mb: number): { value: number; unit: SizeUnit } {
  if (Number.isFinite(mb) && mb >= MB_PER_GB && mb % GB_ALIGN_MB === 0) {
    return { value: mb / MB_PER_GB, unit: "GB" };
  }
  return { value: Number.isFinite(mb) ? mb : 0, unit: "MB" };
}
