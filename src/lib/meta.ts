// Resource.meta：按类型分型的 JSON 文本。这里统一 zod 校验/解析。
// 数据库里存 JSON.stringify 的字符串（SQLite 兼容），读取出 parseMeta。
import { z } from "zod";
import { AV_CAPTION_TEXT_MAX, AV_CAPTIONS_MAX, CAPTION_FORMATS } from "@/lib/captions";

// 下载地址：http(s) 外链或站内附件 /uploads 路径（与 commonFields.externalUrl 同规则）
const urlLike = (v: string) => !v || /^https?:\/\/.+/i.test(v) || /^\/[^/].*$/i.test(v);

/**
 * 下载来源判定：**站内存储路径一律算「附件」**（`/od/{driveId}/…` OneDrive 代理、`/uploads/…`
 * 本地盘、其它 `/xxx` 自描述引用），只有 http(s) 外链才算「外链」。
 *
 * 为什么按 URL 重判而不是信存下来的 kind/mode：这几个字段是写入当时记的，历史数据里存在
 * 「同一批走 OneDrive 的文件，一个记成 file、一个记成 link」的脏值。症状是详情页同一份清单里
 * 「附件 / 外链」混着显示，且被判成 link 的那条会走新标签页原样打开（拿不到原名、也不经 /api/dl
 * 计数）。写入与读取两侧都过这一层，存量数据也一并治好，不用改库。
 */
export function downloadKindOf(kind: "file" | "link", url: string): "file" | "link" {
  return url.trim().startsWith("/") ? "file" : kind;
}

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
  })
  // 站内路径（含 /od/ 云盘引用）统一归为 file，见 downloadKindOf
  .transform((d) => ({ ...d, mode: d.mode === "none" ? d.mode : downloadKindOf(d.mode, d.url) }));

// ARTICLE 单个附件项（清单行）
const articleItemSchema = z
  .object({
    name: z.string().trim().min(1, "附件名不能为空").max(120, "附件名过长"),
    kind: z.enum(["file", "link"]),
    url: z
      .string()
      .trim()
      .min(1, "请填写附件地址")
      .max(2000, "地址过长")
      .refine(urlLike, "地址需以 http(s):// 或站内附件路径开头"),
    size: z.string().max(40).optional(),
  })
  // 来源按 URL 重新判定：走 OneDrive（/od/…）与其它站内路径的一律是「附件」
  .transform((d) => ({ ...d, kind: downloadKindOf(d.kind, d.url) }));

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

// GAME：平台/语言 + 下载源清单（D1）。GAME 没有版本概念——下载源本身就是清单，
// 不按版本分代（历史上曾把清单存进 ResourceVersion 表并渲染成「版本历史」，已废弃）。
// size / license / note 已从发布页移除，schema 仍保留字段以兼容存量数据（读取时按缺省忽略）。
export const gameMetaSchema = z.object({
  /** @deprecated 已废弃：GAME 不再展示版本号，仅存量数据回读 */
  version: z.string().max(40).optional(),
  size: z.string().max(40).optional(),
  platforms: z.array(z.string().max(20)).optional(),
  lang: z.string().max(40).optional(),
  license: z.string().max(40).default(""),
  /** @deprecated 发布/改稿表单已移除「说明」输入，仅存量数据回读 */
  note: z.string().max(300).optional(),
  // 下载源清单：这是 GAME 下载源的唯一存储（仅 link：作者外链 / 站内附件路径）
  downloads: z.array(articleItemSchema).max(20).default([]),
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

/** 分P 上限：够放一张专辑 / 一季剧集，又不至于把 meta 与播放器列表撑爆 */
export const AV_TRACKS_MAX = 60;

/**
 * 单个分P / 曲目。**不含主来源那一 P**（主来源仍是顶层 url/duration，见 avMetaSchema）——
 * 这样存量数据（只有 url）零迁移就是「单 P 资源」，播放列表由 lib/av-tracks.ts 统一拼装。
 *
 * 分P 的标题可留空（列表里回退显示「P3 / 曲目 3」）；时长可留空（不会自动抓取，
 * 抓取只对向导里手动上传的主文件做，见 av-section.tsx）。
 */
export const avTrackSchema = z.object({
  title: z.string().trim().max(120, "标题过长").default(""),
  url: z
    .string()
    .trim()
    .min(1, "请填写分P 地址")
    .max(2000, "地址过长")
    .refine(urlLike, "地址需为 http(s):// 外链或站内文件路径"),
  duration: z.string().trim().max(20).optional(),
});
export type AvTrack = z.infer<typeof avTrackSchema>;

/**
 * 一份字幕 / 歌词。
 *
 * 文本**直接内联在 meta 里**，不存地址：站内云盘引用（/od/…）会 302 到不带 CORS 头的 Graph
 * 预鉴权链接，客户端拉不到；内联既绕开这一点，也省掉一个「本站转发字节」的代理路由。
 * 代价是 meta 会变大，所以文本有硬上限（见 AV_CAPTION_TEXT_MAX），且 feedSelect 不取 meta。
 *
 * 格式由作者在向导里选定（可被内容嗅探纠偏），解析在浏览器做（见 lib/captions.ts）。
 * `label` 是多语言 / 多版本时的展示名（可空，空则回退「字幕 1」）。
 */
export const avCaptionSchema = z.object({
  label: z.string().trim().max(60).default(""),
  format: z.enum(CAPTION_FORMATS).default("srt"),
  text: z
    .string()
    .min(1, "字幕内容为空")
    .max(AV_CAPTION_TEXT_MAX, `单份字幕文本不能超过 ${AV_CAPTION_TEXT_MAX} 字符`),
});
export type AvCaption = z.infer<typeof avCaptionSchema>;

export const avMetaSchema = z
  .object({
    source: z.enum(AV_SOURCES).default("mount"),
    mode: z.enum(AV_MODES).default("direct"),
    url: z.string().trim().max(2000).default(""),
    artist: z.string().trim().max(80).optional(), // 音乐：艺术家（自动读取）
    duration: z.string().trim().max(20).optional(), // 时长，如 3:42
    resolution: z.string().trim().max(20).optional(), // 视频：分辨率，如 1080p
    /** 分P / 曲目（不含主来源）；空数组 = 单 P 资源，与存量数据同形 */
    tracks: z.array(avTrackSchema).max(AV_TRACKS_MAX, `分P 不能超过 ${AV_TRACKS_MAX} 条`).default([]),
    /** 字幕 / 歌词（整份资源共用；音频显示为滚动歌词，视频叠在画面上） */
    captions: z
      .array(avCaptionSchema)
      .max(AV_CAPTIONS_MAX, `字幕不能超过 ${AV_CAPTIONS_MAX} 条`)
      .default([]),
    downloads: z.array(articleItemSchema).max(20).default([]),
  })
  .superRefine((d, cx) => {
    // 主来源可以为空——只要有分P 就成立（作者可能把每一集都填进分P 列表里）
    if (!d.url && d.tracks.length === 0)
      cx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: d.source === "file" ? "请上传音频/视频文件" : "请填写在线音频/视频地址",
      });
    else if (d.url && !urlLike(d.url))
      cx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "地址需为 http(s):// 外链或站内文件路径",
      });
    else if (d.url && d.source === "mount" && !/^https?:\/\/.+/i.test(d.url))
      cx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "在线挂载需填写 http(s):// 开头的外部地址",
      });
    else if (d.url && d.mode === "embed" && !/^https?:\/\/.+/i.test(d.url))
      cx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "嵌入页挂载需填写 http(s):// 开头的页面地址",
      });
    // 嵌入页的分P 也是挂 iframe，站内路径会被浏览器当相对地址解析 → 一律要求绝对页面地址
    if (d.mode === "embed" && d.tracks.some((t) => !/^https?:\/\/.+/i.test(t.url)))
      cx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tracks"],
        message: "嵌入页挂载需填写 http(s):// 开头的页面地址",
      });
  });
export type AvMeta = z.infer<typeof avMetaSchema>;

/** 空/坏数据兜底：不填来源就不算坏，详情页据此提示「未提供播放来源」 */
export const AV_META_FALLBACK: AvMeta = {
  source: "mount",
  mode: "direct",
  url: "",
  tracks: [],
  captions: [],
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
    // tracks / captions 都是附加信息：**一条脏分P 或超长字幕不该把主来源一起拖没**——
    // 历史数据里 url 已经落库，若整块回落到 AV_META_FALLBACK，播放卡会直接变成
    // 「作者未提供播放来源」。所以逐级降级：先丢字幕（长文本最容易被旧上限卡住），
    // 再丢分P，仍失败才走兜底。
    const attempts = [
      obj,
      { ...(obj as object), captions: [] },
      { ...(obj as object), tracks: [], captions: [] },
    ];
    let data: AvMeta | null = null;
    for (const candidate of attempts) {
      const r = avMetaSchema.safeParse(candidate);
      if (r.success) {
        data = r.data;
        break;
      }
    }
    const meta = data ?? AV_META_FALLBACK;
    return kind === "MUSIC" ? { kind: "MUSIC", ...meta } : { kind: "VIDEO", ...meta };
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
