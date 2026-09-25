// 首页板块引擎 —— 纯数据/校验层（不依赖 server，可被前后端与 seed 共用）。
// 板块类型目录、每类 config 的 zod 校验、默认布局。
import { z } from "zod";
import type { CardRatio, ContentTypeFilter } from "./display";
import { safeUrlSchema } from "./site-config";

export type HomeSectionKind =
  | "hero"
  | "categories"
  | "list"
  | "featured"
  | "feed"
  | "stats"
  | "creators"
  | "tags"
  | "ad"
  | "recommend";

export const HOME_SECTION_KINDS: HomeSectionKind[] = [
  "hero",
  "categories",
  "list",
  "featured",
  "feed",
  "stats",
  "creators",
  "tags",
  "ad",
  "recommend",
];

export const HOME_KIND_META: Record<
  HomeSectionKind,
  { label: string; desc: string; defaultTitle: string | null }
> = {
  hero: { label: "主推精选", desc: "第一个资源固定大图主推，后续副推可调小卡片/列表与尺寸", defaultTitle: null },
  categories: {
    label: "分类导航",
    desc: "分类直达入口；可按大类筛选，或手动挑选特定分类",
    defaultTitle: "按分类探索",
  },
  list: {
    label: "内容流板块",
    desc: "自选条件的内容列表：类型/排序/数量/分类标签多选，卡片·列表，可点击或无限加载",
    defaultTitle: "精选内容",
  },
  featured: {
    label: "专题精选",
    desc: "把指定资源组成一个专题网格（支持卡片/列表）",
    defaultTitle: "专题",
  },
  feed: {
    label: "全站浏览",
    desc: "统一 3:4 卡片网格的全站内容浏览（跟 /browse 一致，跟随页面查询参数）",
    defaultTitle: "发现",
  },
  stats: { label: "数据一览", desc: "社区规模数字横幅", defaultTitle: "社区数据" },
  creators: {
    label: "人气创作者",
    desc: "创作者排行；可按粉丝数，或按贡献分（激励体系口径）",
    defaultTitle: "人气创作者",
  },
  tags: {
    label: "热门标签",
    desc: "标签云快捷入口；可按热度，或手动挑选特定标签",
    defaultTitle: "热门标签",
  },
  ad: {
    label: "广告位",
    desc: "图片+链接 或 HTML/联盟广告代码，带「广告」角标；可插在板块流任意位置",
    defaultTitle: null,
  },
  recommend: {
    label: "为你推荐",
    desc: "登录用户按点赞/收藏/评论/关注构建画像精准推荐，并保留探索槽位打破信息茧房；游客回退全站热门",
    defaultTitle: "为你推荐",
  },
};

export function homeKindLabel(kind: HomeSectionKind): string {
  return HOME_KIND_META[kind]?.label ?? kind;
}

// ---------- 各类板块的 config ----------
const heroCfg = z.object({
  featuredIds: z.array(z.string()).max(8).default([]), // 手动挑选的资源 id；为空则自动展示近期热门
  // 第一个资源始终是大图主推；后续副推允许在后台切换为小卡片或紧凑列表，并调节尺寸。
  secondaryDisplay: z.enum(["card", "list"]).default("card"),
  secondarySize: z.enum(["sm", "md"]).default("sm"),
  // 未挑选时的兜底热门时间窗口：all=累计全时间；week/month=仅近期发布
  period: z.enum(["all", "week", "month"]).default("all"),
});
const categoriesCfg = z.object({
  slugs: z.array(z.string()).max(30).default([]), // 空 = 展示全部分类；否则仅展示所选分类
});
const ratioEnum = z.enum(["auto", "1:1", "4:3", "3:2", "16:9", "3:4"]).default("auto");

/** 内容类型筛选（含「全部」）：与 display.CONTENT_TYPES 同源，新增类型只改一处 */
const typeFilterEnum = z.enum(["ALL", "IMAGE", "GAME", "ARTICLE", "MUSIC", "VIDEO"]).default("ALL");

const listCfg = z.object({
  type: typeFilterEnum,
  sort: z.enum(["latest", "popular", "downloads"]).default("latest"),
  count: z.number().int().min(1).max(48).default(12),
  categorySlugs: z.array(z.string()).max(30).default([]), // 空 = 不限
  tagSlugs: z.array(z.string()).max(30).default([]), // 空 = 不限；否则任一命中
  display: z.enum(["card", "list"]).default("card"),
  paged: z.boolean().default(false), // 是否允许追加加载后续页
  // 追加方式：button=点「加载更多 / 下一页」按钮；infinite=滚近底部自动取下一页。
  // 仅在 paged=true 时生效；存量数据没有这个键，默认回落 button（与旧行为一致）。
  loadMode: z.enum(["button", "infinite"]).default("button"),
  ratio: ratioEnum, // 卡片封面比例；auto=默认 3:4
  // 排序=最热/最多下载 时的时间窗口：all=累计全时间；week/month=仅近期发布
  period: z.enum(["all", "week", "month"]).default("all"),
});
const featuredCfg = z.object({
  featuredIds: z.array(z.string()).max(24).default([]), // 专题挑选的资源 id；为空自动兜底近期热门
  display: z.enum(["card", "list"]).default("card"),
  ratio: ratioEnum,
  // 未挑选时的兜底热门时间窗口：all=累计全时间；week/month=仅近期发布
  period: z.enum(["all", "week", "month"]).default("all"),
});
const feedCfg = z.object({
  showTags: z.boolean().default(false), // 全站浏览顶部是否带热门标签行
});
const statsCfg = z.object({});
const creatorsCfg = z.object({
  count: z.number().int().min(1).max(12).default(6),
  // 排序口径：followers=按粉丝数（原行为）；points=按贡献分（激励体系的口径）。
  // 【兼容红线】默认值必须是 followers —— 存量配置只有 count，改默认会让现网排序被动变化。
  sort: z.enum(["followers", "points"]).default("followers"),
  // 时间窗口：all=累计；week/month=滚动窗口（近 7 / 30 天）。
  // followers 下 = 近期新增关注；points 下 = 窗口内贡献分（与 /creators 周榜/月榜同口径）。
  period: z.enum(["all", "week", "month"]).default("all"),
});
const tagsCfg = z.object({
  count: z.number().int().min(1).max(24).default(12),
  slugs: z.array(z.string()).max(30).default([]), // 空 = 按热度 top count；否则仅展示所选标签
});
const adCfg = z.object({
  mode: z.enum(["image", "html"]).default("image"),
  image: safeUrlSchema(2000), // 图片地址（image 模式）
  link: safeUrlSchema(500), // 跳转链接，可空 = 纯展示
  alt: z.string().max(120).default(""),
  html: z.string().max(8000).default(""), // 联盟广告代码片段（html 模式）
  badge: z.boolean().default(true), // 是否显示「广告」角标
});
const recommendCfg = z.object({
  scope: z.enum(["personal", "all"]).default("personal"), // personal=按登录用户偏好；all=全站热门
  // 模式：personalized=画像精准推荐；explore=随机探索（每次刷新换一批高质量/新内容，打破信息茧房）
  mode: z.enum(["personalized", "explore"]).default("personalized"),
  type: typeFilterEnum,
  count: z.number().int().min(1).max(48).default(12),
  categorySlugs: z.array(z.string()).max(30).default([]), // 空 = 不限
  // 探索占比：用于打破信息茧房，将一部分槽位留给用户「没怎么接触过」的优质/新内容（0–0.6，默认 0.3）
  explorationRatio: z.number().min(0).max(0.6).default(0.3),
  // 最终列表最少覆盖的不同分类数；0 = 自动（min(3, count)），防止整页同质
  minCategories: z.number().int().min(0).max(12).default(0),
  // 热度时间窗口：all=累计全时间热门；week/month=仅统计近期发布资源（实现「近期热门推荐」）
  period: z.enum(["all", "week", "month"]).default("all"),
});

export const homeConfigSchemas: Record<HomeSectionKind, z.ZodTypeAny> = {
  hero: heroCfg,
  categories: categoriesCfg,
  list: listCfg,
  featured: featuredCfg,
  feed: feedCfg,
  stats: statsCfg,
  creators: creatorsCfg,
  tags: tagsCfg,
  ad: adCfg,
  recommend: recommendCfg,
};

export type HomeSectionConfig =
  | {
      featuredIds: string[];
      secondaryDisplay: "card" | "list";
      secondarySize: "sm" | "md";
      period: "all" | "week" | "month";
    } // hero
  | { slugs: string[] } // categories
  | {
      type: ContentTypeFilter;
      sort: "latest" | "popular" | "downloads";
      count: number;
      categorySlugs: string[];
      tagSlugs: string[];
      display: "card" | "list";
      paged: boolean;
      loadMode: "button" | "infinite";
      ratio: CardRatio;
      period: "all" | "week" | "month";
    } // list
  | { featuredIds: string[]; display: "card" | "list"; ratio: CardRatio; period: "all" | "week" | "month" } // featured
  | { showTags: boolean } // feed
  | Record<string, never> // stats
  | { count: number; sort: "followers" | "points"; period: "all" | "week" | "month" } // creators
  | { count: number; slugs: string[] } // tags
  | {
      mode: "image" | "html";
      image: string;
      link: string;
      alt: string;
      html: string;
      badge: boolean;
    } // ad
  | { scope: "personal" | "all"; mode: "personalized" | "explore"; type: ContentTypeFilter; count: number; categorySlugs: string[]; explorationRatio: number; minCategories: number; period: "all" | "week" | "month" }; // recommend

// 后端传给编辑器的类型化 config
export type EditableConfig<T extends HomeSectionKind> = z.infer<(typeof homeConfigSchemas)[T]>;

/** 从 DB JSON 文本解析为已校验 config（坏数据兜底为默认值） */
export function parseSectionConfig(kind: HomeSectionKind, raw: string | null): HomeSectionConfig {
  let obj: unknown = {};
  if (raw) {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }
  }
  // 存量迁移：display="masonry" 已下线 → 字段级归一到 "card"，保住 type/sort/count/分类/标签 等其它字段
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>;
    if ((kind === "list" || kind === "featured") && o.display === "masonry") o.display = "card";
  }
  const schema = homeConfigSchemas[kind];
  const r = schema.safeParse(obj);
  return r.success ? (r.data as HomeSectionConfig) : (schema.parse({}) as HomeSectionConfig);
}

/** 保存前校验编辑面板提交的 config，返回规范化结果 */
export function safeHomeConfig(
  kind: HomeSectionKind,
  value: unknown,
): { ok: true; data: HomeSectionConfig } | { ok: false; error: string } {
  const schema = homeConfigSchemas[kind];
  const r = schema.safeParse(value);
  if (r.success) return { ok: true, data: r.data as HomeSectionConfig };
  return { ok: false, error: r.error.issues[0]?.message ?? "配置不合法" };
}

// ---------- 默认布局（新库 / 空表兜底，也是后台首个管理入口的初始化值） ----------
export type DefaultSectionSpec = {
  kind: HomeSectionKind;
  title: string | null;
  order: number;
  enabled: boolean;
  config: HomeSectionConfig;
};

export const DEFAULT_SECTIONS: DefaultSectionSpec[] = [
  {
    kind: "hero",
    title: null,
    order: 10,
    enabled: true,
    config: { featuredIds: [], secondaryDisplay: "card", secondarySize: "sm", period: "all" },
  },
  // 分类入口统一由侧栏「分类直达」承担，首页默认不再重复展示整块分类列表（可在后台按需开启）
  { kind: "categories", title: "按分类探索", order: 20, enabled: false, config: { slugs: [] } },
  { kind: "feed", title: null, order: 30, enabled: true, config: { showTags: false } },
  { kind: "tags", title: "热门标签", order: 40, enabled: false, config: { count: 12, slugs: [] } },
  {
    kind: "creators",
    title: "人气创作者",
    order: 50,
    enabled: false,
    config: { count: 6, sort: "followers", period: "all" },
  },
  { kind: "stats", title: "社区数据", order: 60, enabled: false, config: {} },
];
