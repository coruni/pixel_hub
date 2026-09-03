// Resource.meta：按类型分型的 JSON 文本。这里统一 zod 校验/解析。
// 数据库里存 JSON.stringify 的字符串（SQLite 兼容），读取出 parseMeta。
import { z } from "zod";

// IMAGE：覆盖原创/AI生成/壁纸素材/截图四类（D2）
export const imageMetaSchema = z.object({
  isAiGenerated: z.boolean().default(false),
  aiTool: z.string().max(60).optional(),
  aiModel: z.string().max(60).optional(),
  original: z.boolean().default(false),
  license: z.string().max(40).default(""),
  sourceNote: z.string().max(200).optional(),
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

// ARTICLE：正文即 description（Markdown），meta 暂无扩展字段
export const articleMetaSchema = z.object({
  license: z.string().max(40).default(""),
});
export type ArticleMeta = z.infer<typeof articleMetaSchema>;

export type ResourceMetaOutput =
  | ({ kind: "IMAGE" } & ImageMeta)
  | ({ kind: "GAME" } & GameMeta)
  | ({ kind: "ARTICLE" } & ArticleMeta);

export function parseMeta(kind: "GAME" | "IMAGE" | "ARTICLE", raw: string | null): ResourceMetaOutput {
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
