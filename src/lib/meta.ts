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
  download: imageDownloadSchema.default({ mode: "none", url: "" }), // 旧数据无此键 → none
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

export type ResourceMetaOutput =
  | ({ kind: "IMAGE" } & ImageMeta)
  | ({ kind: "GAME" } & GameMeta)
  | ({ kind: "ARTICLE" } & ArticleMeta);

export function parseMeta(
  kind: "GAME" | "IMAGE" | "ARTICLE",
  raw: string | null,
): ResourceMetaOutput {
  if (kind === "GAME") {
    const parsed = z.unknown().safeParse(raw);
    let obj: unknown = {};
    if (parsed.success && raw) {
      try {
        obj = JSON.parse(raw);
      } catch {
        obj = {};
      }
    }
    const r = gameMetaSchema.safeParse(obj);
    return { kind: "GAME", ...(r.success ? r.data : gameMetaSchema.parse({})) };
  }
  let obj: unknown = {};
  if (raw) {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }
  }
  if (kind === "ARTICLE") {
    const r = articleMetaSchema.safeParse(obj);
    return { kind: "ARTICLE", ...(r.success ? r.data : articleMetaSchema.parse({})) };
  }
  const r = imageMetaSchema.safeParse(obj);
  return { kind: "IMAGE", ...(r.success ? r.data : imageMetaSchema.parse({})) };
}

/** 该资源是否实际提供 meta 驱动的下载（服务端计数守卫用）。GAME 走 externalUrl，返回 false */
export function metaHasDownload(m: ResourceMetaOutput): boolean {
  if (m.kind === "IMAGE") return m.download.mode !== "none" && !!m.download.url;
  if (m.kind === "ARTICLE") return m.downloads.length > 0;
  return false;
}
