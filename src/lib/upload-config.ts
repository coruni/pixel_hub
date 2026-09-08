// 上传限制配置 —— 纯数据/校验层（不依赖 server，可被前后端与 seed 共用）。
// 文档存于 SiteSetting["uploadLimits"]（JSON 文本），带 version 乐观锁（读写见 upload-limits.ts）。
// 结构：
// {
//   attachmentMaxMb,        // 附件单文件上限 MB（1..256000；256000 = OneDrive 250GiB）
//   attachmentExts,         // 附件允许后缀（全小写不带点，命中 DENY_EXTS 一律拒绝）
//   galleryImageMaxMb,      // 图集/原图单张 + 后台直传（1..100）
//   commentImageMaxMb,      // 评论附图单张（1..100）
//   avatarMaxMb,            // 头像（1..100）
// }
//
// 服务端各上传路由/action 每次请求读一次配置并**以此为准**强制执行；
// 缺失/坏数据经 parseUploadLimits 回退代码内默认，绝不抛错（与 theme 一致）。

export const UPLOAD_LIMITS_KEY = "uploadLimits";

export const MIB = 1024 * 1024;

/** OneDrive 单文件上限：250GiB，配置字段以 MiB 存储。 */
export const MAX_ATTACHMENT_MB = 250 * 1024;

/** 附件后缀：≤200 项、每项 ^[a-z0-9]{1,10}$（全小写、不带点） */
export const MAX_EXT_COUNT = 200;
export const EXT_TOKEN_RE = /^[a-z0-9]{1,10}$/;

/** 数值范围：附件上限受 OneDrive Graph 单文件 250GiB 约束；图片类另设档位 */
export const MB_RANGE = {
  attachment: { min: 1, max: MAX_ATTACHMENT_MB },
  image: { min: 1, max: 100 },
} as const;

/** 单批次/单资源图片数量上限范围（张）。图集/文章插图共用此档位；评论图单独更窄的默认 */
export const COUNT_RANGE = { min: 1, max: 60 } as const;
/** 评论附图数量上限范围（张） */
export const COMMENT_COUNT_RANGE = { min: 0, max: 20 } as const;

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
  /** 图集 / 原图：单个资源可上传的图片张数上限（IMAGE 类型预览图） */
  galleryImageMaxCount: number;
  /** 评论附图：单条评论可附带的图片张数上限 */
  commentImageMaxCount: number;
};

/** 文章媒体固定为 1 张封面，其余插图放正文（编辑器内上传），不做后台配置 */
export const ARTICLE_MEDIA_MAX = 1;

/** 默认 = 今日各处硬编码值原样迁入（附件 200MB + 29 后缀；图集 20；评论图 5；头像 5） */
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
  galleryImageMaxCount: 12,
  commentImageMaxCount: 3,
};

// ---------- 数值 / 后缀校验（纯函数） ----------

export function clampInt(n: unknown, min: number, max: number, dflt: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
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
    galleryImageMaxCount: clampInt(
      o.galleryImageMaxCount,
      COUNT_RANGE.min,
      COUNT_RANGE.max,
      12,
    ),
    commentImageMaxCount: clampInt(
      o.commentImageMaxCount,
      COMMENT_COUNT_RANGE.min,
      COMMENT_COUNT_RANGE.max,
      3,
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

/** “≤200MB” / “≤250GB” 式体积提示 */
export function mbText(mb: number): string {
  return mb >= 1024 ? `≤${mb / 1024}GB` : `≤${mb}MB`;
}
