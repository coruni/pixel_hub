import { z } from "zod";
import { isSingleCoverType } from "@/lib/upload-config";

/**
 * 发布草稿：结构定义 + 序列化/摘要工具（纯函数层，前后端共用）。
 *
 * 设计取舍：草稿存「用户已填过的字段快照」而不是 Resource 行。
 * 半成品通常连标题、分类、图片都不齐，塞进 Resource 会撞必填字段、slug 唯一键与各类聚合计数；
 * 独立表可以随时整条丢弃，也不会有半成品漏进前台查询的风险。
 *
 * 本文件被客户端组件 import，禁止引入 server-only 依赖。
 */

/** 每个用户最多保留的草稿条数（超出按最旧丢弃） */
export const DRAFT_MAX_PER_USER = 20;

/** 自动保存的静默间隔（毫秒）：停止输入后多久写一次 */
export const DRAFT_AUTOSAVE_DELAY = 1800;

/**
 * 自动保存的兜底周期（毫秒）：连续敲字时上面那个防抖计时器会被不断重置，
 * 一直不落库；这个定时器不管有没有停手都按点存一次（内容没变则跳过，不写库）。
 */
export const DRAFT_AUTOSAVE_INTERVAL = 30_000;

/** 草稿标题展示上限 */
export const DRAFT_TITLE_MAX = 200;

/** 可发布的五种类型（与 ResourceType 的前端子集一致） */
export const DRAFT_TYPES = ["GAME", "IMAGE", "ARTICLE", "MUSIC", "VIDEO"] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];

// 各字段长度上限：既做脏数据兜底，也挡住调用方伪造超长 payload 打 DB
const text = (max: number) => z.string().max(max).optional().default("");
const flag = z.boolean().optional().default(false);

export const draftMediaSchema = z.object({
  id: z.string().max(64),
  name: z.string().max(200).optional().default(""),
  ok: z.boolean().optional().default(false),
  error: z.string().max(200).optional(),
  thumbUrl: z.string().max(1200).nullable().optional().default(null),
  bigUrl: z.string().max(1200).nullable().optional().default(null),
  origUrl: z.string().max(1200).nullable().optional().default(null),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});
export type DraftMedia = z.infer<typeof draftMediaSchema>;

export const draftPayloadSchema = z.object({
  type: z.enum(DRAFT_TYPES),
  // —— 基础信息 ——
  title: text(DRAFT_TITLE_MAX),
  summary: text(400),
  description: text(40000), // 正文上限 20000 字，UTF-16 折半留足余量
  categoryId: text(64),
  tags: text(800),
  // —— 媒体（已上传完成的图片/封面）——
  media: z.array(draftMediaSchema).max(60).optional().default([]),
  coverId: text(64),
  // —— 各类型分节（同一时刻只有一节被渲染，未渲染的字段回落空串）——
  downloads: text(20000), // 附件清单隐藏字段原文（JSON 字符串）
  externalUrl: text(2000),
  version: text(80),
  size: text(80),
  platforms: text(200),
  lang: text(80),
  license: text(80),
  note: text(600),
  changelog: text(4000),
  isAiGenerated: flag,
  original: flag,
  avSource: text(16),
  avUrl: text(2000),
  avMode: text(16),
  avProvider: text(120),
  duration: text(40),
  artist: text(160),
  album: text(160),
  resolution: text(40),
  // —— 发布选项 ——
  nsfw: flag,
  loginRequired: flag,
  allowComments: flag,
  isDownloadable: flag,
});
export type DraftPayload = z.infer<typeof draftPayloadSchema>;

/** 解析草稿 payload（坏数据一律回落空草稿，绝不抛错） */
export function parseDraftPayload(type: string, raw: string | null): DraftPayload {
  const safeType = (DRAFT_TYPES as readonly string[]).includes(type)
    ? (type as DraftType)
    : "IMAGE";
  if (!raw) return draftPayloadSchema.parse({ type: safeType });
  try {
    const r = draftPayloadSchema.safeParse(JSON.parse(raw));
    if (r.success) return r.data;
  } catch {
    // 坏 JSON：走回落
  }
  return draftPayloadSchema.parse({ type: safeType });
}

/** 草稿是否有实质内容：空草稿不落库，避免「打开页面就生成一条空记录」 */
export function draftHasContent(p: DraftPayload): boolean {
  if (p.media.length > 0) return true;
  const texts = [
    p.title,
    p.summary,
    p.description,
    p.categoryId,
    p.tags,
    p.externalUrl,
    p.version,
    p.size,
    p.platforms,
    p.lang,
    p.license,
    p.note,
    p.changelog,
    p.avUrl,
    p.avProvider,
    p.duration,
    p.artist,
    p.album,
    p.resolution,
  ];
  if (texts.some((t) => t.trim() !== "")) return true;
  return p.downloads.trim() !== "" && p.downloads.trim() !== "[]";
}

/** 列表标题：未填标题时给一个可辨认的占位 */
export function draftTitleOf(p: DraftPayload): string {
  const t = p.title.trim();
  if (t) return t;
  if (p.avUrl.trim()) return p.avUrl.trim();
  return "未命名草稿";
}

/** 去掉 Markdown 标记取纯文本，用于草稿列表摘要 */
function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 列表摘要：简介 → 正文 → 外链/音频地址，都没有则空 */
export function draftExcerptOf(p: DraftPayload, max = 72): string {
  const src =
    p.summary.trim() || plainText(p.description) || p.externalUrl.trim() || p.avUrl.trim();
  if (!src) return "";
  return src.length > max ? `${src.slice(0, max)}…` : src;
}

/** 草稿是否已具备发布所需的最小内容（用于草稿箱给「可继续发布」提示） */
export function draftReadyHint(p: DraftPayload): string | null {
  if (p.title.trim().length < 3) return "还差标题";
  if (!p.categoryId) return "还差分类";
  if (p.description.trim().length < 10) return "还差描述";
  if (p.type === "GAME" && !p.externalUrl.trim()) return "还差下载外链";
  if ((p.type === "MUSIC" || p.type === "VIDEO") && !p.avUrl.trim()) return "还差来源地址";
  // 封面类（文章/音乐/视频）封面可选，不据此拦发布；图集类仍需至少一张图
  if (!isSingleCoverType(p.type) && !p.coverId && p.media.length === 0) return "还差图片";
  return null;
}

// ---------- 从表单收集快照（客户端用；未渲染的字段回落空串） ----------

type MediaLike = {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
  thumbUrl: string | null;
  bigUrl: string | null;
  origUrl: string | null;
  width?: number | null;
  height?: number | null;
};

/**
 * 把向导表单 + 客户端受控 state（媒体/封面）拼成草稿快照。
 * 非受控输入直接从 FormData 读，受控 state 由调用方传入，避免两处字段定义漂移。
 */
export function collectDraft(
  form: HTMLFormElement | null,
  media: MediaLike[],
  coverId: string,
  fallbackType: DraftType,
): unknown {
  const fd = form ? new FormData(form) : new FormData();
  const str = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v : "";
  };
  // checkbox 未勾选时不会出现在 FormData 里 → get() 为 null 即未勾选
  const on = (k: string) => fd.get(k) !== null;
  const type = str("type");
  return {
    type: (DRAFT_TYPES as readonly string[]).includes(type) ? type : fallbackType,
    title: str("title"),
    summary: str("summary"),
    description: str("description"),
    categoryId: str("categoryId"),
    tags: str("tags"),
    media,
    coverId,
    downloads: str("downloads"),
    externalUrl: str("externalUrl"),
    version: str("version"),
    size: str("size"),
    platforms: str("platforms"),
    lang: str("lang"),
    license: str("license"),
    note: str("note"),
    changelog: str("changelog"),
    isAiGenerated: on("isAiGenerated"),
    original: on("original"),
    avSource: str("avSource"),
    avUrl: str("avUrl"),
    avMode: str("avMode"),
    avProvider: str("avProvider"),
    duration: str("duration"),
    artist: str("artist"),
    album: str("album"),
    resolution: str("resolution"),
    nsfw: on("nsfw"),
    loginRequired: on("loginRequired"),
    allowComments: on("allowComments"),
    isDownloadable: on("isDownloadable"),
  };
}

/** 相对时间：hh:mm / 昨天 hh:mm / M 月 D 日 */
export function draftTimeText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return `今天 ${hm}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate()
  )
    return `昨天 ${hm}`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`;
}
