// Resource.meta：按类型分型的 JSON 文本。这里统一 zod 校验/解析。
// 数据库里存 JSON.stringify 的字符串（SQLite 兼容），读取出 parseMeta。
import { z } from "zod";

// 下载地址：http(s) 外链或站内附件 /uploads 路径（与 commonFields.externalUrl 同规则）
const urlLike = (v: string) => !v || /^https?:\/\/.+/i.test(v) || /^\/[^/].*$/i.test(v);

// IMAGE 单条「图包/整套」下载：mode none/file/link。区别于 GAME（无版本/平台表）
export const imageDownloadSchema = z
  .object({
    mode: z.enum(["none", "file", "link"]).default("none"),
    url: z.string().max(2000).default(""),
    fileName: z.string().max(120).optional(), // 展示名（含扩展名），如 原画集.zip
    size: z.string().max(40).optional(), // 展示大小，如 128 MB
  })
  .superRefine((d, cx) => {
    if (d.mode !== "none" && !urlLike(d.url))
      cx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "选择文件/外链后需填写 http(s):// 或站内附件路径",
      });
  });

// ARTICLE 单个附件项（清单行）
const articleItemSchema = z.object({
  name: z.string().trim().min(1, "附件名不能为空").max(120, "附件名过长"),
  kind: z.enum(["file", "link"]),
  url: z
    .string()
    .trim()
    .min(1, "请填写附件地址")
    .max(2000, "地址过长")
    .refine(urlLike, "地址需以 http(s):// 或站内附件路径开头"),
  size: z.string().max(40).optional(),
});

// IMAGE：覆盖原创/AI生成/壁纸素材/截图四类（D2）
export const imageMetaSchema = z.object({
  isAiGenerated: z.boolean().default(false),
  aiTool: z.string().max(60).optional(),
  aiModel: z.string().max(60).optional(),
  original: z.boolean().default(false),
  license: z.string().max(40).default(""),
  sourceNote: z.string().max(200).optional(),
  download: imageDownloadSchema.default({ mode: "none", url: "" }), // 旧数据无此键 → none（向后兼容单附件）
  downloads: z.array(articleItemSchema).max(20).default([]), // 多附件图包/整套清单（与 ARTICLE 同源）
});
export type ImageMeta = z.infer<typeof imageMetaSchema>;

// GAME：版本/大小/平台/语言/授权（D1）
export const gameMetaSchema = z.object({
  version: z.string().max(40).optional(),
  size: z.string().max(40).optional(),
  platforms: z.array(z.string().max(20)).optional(),
  lang: z.string().max(40).optional(),
  license: z.string().max(40).default(""),
  note: z.string().max(300).optional(),
});
export type GameMeta = z.infer<typeof gameMetaSchema>;

// ARTICLE：正文即 description（Markdown）；meta 可带文末附件清单
export const articleMetaSchema = z.object({
  license: z.string().max(40).default(""),
  downloads: z.array(articleItemSchema).max(20).default([]), // 旧数据无此键 → []
});
export type ArticleMeta = z.infer<typeof articleMetaSchema>;

// MUSIC / VIDEO：音视频来源（在线挂载 / 上传文件）与播放形态（直链 / 嵌入页）。
// 只描述「从哪来、怎么播」，下载清单沿用 downloads（与 IMAGE/ARTICLE 同源）。
export const AV_SOURCES = ["mount", "file"] as const;
export const AV_MODES = ["direct", "embed"] as const;

export const avMetaSchema = z
  .object({
    source: z.enum(AV_SOURCES).default("mount"),
    mode: z.enum(AV_MODES).default("direct"),
    url: z.string().trim().max(2000).default(""),
    provider: z.string().trim().max(60).optional(), // 挂载平台名，如 B站 / 网易云
    artist: z.string().trim().max(80).optional(), // 音乐：艺术家
    album: z.string().trim().max(80).optional(), // 音乐：专辑
    duration: z.string().trim().max(20).optional(), // 时长，如 3:42
    resolution: z.string().trim().max(20).optional(), // 视频：分辨率，如 1080p
    license: z.string().max(40).default(""),
    note: z.string().trim().max(300).optional(),
    downloads: z.array(articleItemSchema).max(20).default([]),
  })
  .superRefine((d, cx) => {
    if (!d.url)
      cx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: d.source === "file" ? "请上传音频/视频文件" : "请填写在线音频/视频地址",
      });
    else if (!urlLike(d.url))
      cx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "地址需为 http(s):// 外链或站内文件路径",
      });
    else if (d.source === "mount" && !/^https?:\/\/.+/i.test(d.url))
      cx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "在线挂载需填写 http(s):// 开头的外部地址",
      });
    else if (d.mode === "embed" && !/^https?:\/\/.+/i.test(d.url))
      cx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "嵌入页挂载需填写 http(s):// 开头的页面地址",
      });
  });
export type AvMeta = z.infer<typeof avMetaSchema>;

/** 空/坏数据兜底：不填来源就不算坏，详情页据此提示「未提供播放来源」 */
export const AV_META_FALLBACK: AvMeta = {
  source: "mount",
  mode: "direct",
  url: "",
  license: "",
  downloads: [],
};

export type ResourceMetaKind = "GAME" | "IMAGE" | "ARTICLE" | "MUSIC" | "VIDEO";

export type ResourceMetaOutput =
  | ({ kind: "IMAGE" } & ImageMeta)
  | ({ kind: "GAME" } & GameMeta)
  | ({ kind: "ARTICLE" } & ArticleMeta)
  | ({ kind: "MUSIC" } & AvMeta)
  | ({ kind: "VIDEO" } & AvMeta);

/** 音视频 meta 的窄化类型（详情页播放器 / 下载面板共用） */
export type AvResourceMeta = Extract<ResourceMetaOutput, { kind: "MUSIC" | "VIDEO" }>;

export function isAvMeta(m: ResourceMetaOutput): m is AvResourceMeta {
  return m.kind === "MUSIC" || m.kind === "VIDEO";
}

function parseJsonObject(raw: string | null): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function parseMeta(kind: ResourceMetaKind, raw: string | null): ResourceMetaOutput {
  if (kind === "GAME") {
    const r = gameMetaSchema.safeParse(parseJsonObject(raw));
    return { kind: "GAME", ...(r.success ? r.data : gameMetaSchema.parse({})) };
  }
  const obj = parseJsonObject(raw);
  if (kind === "ARTICLE") {
    const r = articleMetaSchema.safeParse(obj);
    return { kind: "ARTICLE", ...(r.success ? r.data : articleMetaSchema.parse({})) };
  }
  // 音视频共用同一套 schema：source/mode/url + 各自的补充字段
  if (kind === "MUSIC" || kind === "VIDEO") {
    const r = avMetaSchema.safeParse(obj);
    const data = r.success ? r.data : AV_META_FALLBACK;
    return kind === "MUSIC" ? { kind: "MUSIC", ...data } : { kind: "VIDEO", ...data };
  }
  const r = imageMetaSchema.safeParse(obj);
  return { kind: "IMAGE", ...(r.success ? r.data : imageMetaSchema.parse({})) };
}

/** 该资源是否实际提供 meta 驱动的下载（服务端计数守卫用）。GAME 走 externalUrl，返回 false */
export function metaHasDownload(m: ResourceMetaOutput): boolean {
  if (m.kind === "IMAGE")
    return m.downloads.length > 0 || (m.download.mode !== "none" && !!m.download.url);
  if (m.kind === "ARTICLE" || m.kind === "MUSIC" || m.kind === "VIDEO")
    return m.downloads.length > 0;
  return false;
}
