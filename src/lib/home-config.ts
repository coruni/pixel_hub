// 首页板块引擎 —— 纯数据/校验层（不依赖 server，可被前后端与 seed 共用）。
// 板块类型目录、每类 config 的 zod 校验、默认布局。
import { z } from "zod";
import type { CardRatio } from "./display";

export type HomeSectionKind =
  | "hero"
  | "categories"
  | "list"
  | "featured"
  | "feed"
  | "stats"
  | "creators"
  | "tags"
  | "ad";

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
];

export const HOME_KIND_META: Record<HomeSectionKind, { label: string; desc: string; defaultTitle: string | null }> = {
  hero: { label: "主推精选", desc: "大图主推区，可手动挑选要展示的资源", defaultTitle: null },
  categories: { label: "分类导航", desc: "分类直达入口；可按大类筛选，或手动挑选特定分类", defaultTitle: "按分类探索" },
  list: { label: "内容流板块", desc: "自选条件的内容列表：类型/排序/数量/分类标签多选，卡片·列表·瀑布流", defaultTitle: "精选内容" },
  featured: { label: "专题精选", desc: "把指定资源组成一个专题网格（支持卡片/列表/瀑布流）", defaultTitle: "专题" },
  feed: { label: "全站浏览", desc: "可翻页的瀑布流全站浏览（跟 /browse 一致，跟随页面查询参数）", defaultTitle: "发现" },
  stats: { label: "数据一览", desc: "社区规模数字横幅", defaultTitle: "社区数据" },
  creators: { label: "人气创作者", desc: "按粉丝数排行展示创作者", defaultTitle: "人气创作者" },
  tags: { label: "热门标签", desc: "标签云快捷入口；可按热度，或手动挑选特定标签", defaultTitle: "热门标签" },
  ad: { label: "广告位", desc: "图片+链接 或 HTML/联盟广告代码，带「广告」角标；可插在板块流任意位置", defaultTitle: null },
};

export function homeKindLabel(kind: HomeSectionKind): string {
  return HOME_KIND_META[kind]?.label ?? kind;
}

// ---------- 各类板块的 config ----------
const heroCfg = z.object({
  featuredIds: z.array(z.string()).max(8).default([]), // 手动挑选的资源 id；为空则自动展示近期热门
});
const categoriesCfg = z.object({
  slugs: z.array(z.string()).max(30).default([]), // 空 = 展示全部分类；否则仅展示所选分类
});
const ratioEnum = z.enum(["auto", "1:1", "4:3", "3:2", "16:9", "3:4"]).default("auto");

const listCfg = z.object({
  type: z.enum(["ALL", "IMAGE", "GAME", "ARTICLE"]).default("ALL"),
  sort: z.enum(["latest", "popular", "downloads"]).default("latest"),
  count: z.number().int().min(1).max(48).default(12),
  categorySlugs: z.array(z.string()).max(30).default([]), // 空 = 不限
  tagSlugs: z.array(z.string()).max(30).default([]), // 空 = 不限；否则任一命中
  display: z.enum(["card", "list", "masonry"]).default("masonry"),
  paged: z.boolean().default(false), // 允许「下一页 / 加载更多」
  ratio: ratioEnum, // 卡片封面比例；auto=卡片沿用 4:3、瀑布沿用原图
});
const featuredCfg = z.object({
  featuredIds: z.array(z.string()).max(24).default([]), // 专题挑选的资源 id；为空自动兜底近期热门
  display: z.enum(["card", "list", "masonry"]).default("card"),
  ratio: ratioEnum,
});
const feedCfg = z.object({
  showTags: z.boolean().default(false), // 全站浏览顶部是否带热门标签行
});
const statsCfg = z.object({});
const creatorsCfg = z.object({
  count: z.number().int().min(1).max(12).default(6),
});
const tagsCfg = z.object({
  count: z.number().int().min(1).max(24).default(12),
  slugs: z.array(z.string()).max(30).default([]), // 空 = 按热度 top count；否则仅展示所选标签
});
const adCfg = z.object({
  mode: z.enum(["image", "html"]).default("image"),
  image: z.string().max(2000).default(""), // 图片地址（image 模式）
  link: z.string().max(500).default(""), // 跳转链接，可空 = 纯展示
  alt: z.string().max(120).default(""),
  html: z.string().max(8000).default(""), // 联盟广告代码片段（html 模式）
  badge: z.boolean().default(true), // 是否显示「广告」角标
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
};

export type HomeSectionConfig =
  | { featuredIds: string[] } // hero
  | { slugs: string[] } // categories
  | { type: "ALL" | "IMAGE" | "GAME" | "ARTICLE"; sort: "latest" | "popular" | "downloads"; count: number; categorySlugs: string[]; tagSlugs: string[]; display: "card" | "list" | "masonry"; paged: boolean; ratio: CardRatio } // list
  | { featuredIds: string[]; display: "card" | "list" | "masonry"; ratio: CardRatio } // featured
  | { showTags: boolean } // feed
  | Record<string, never> // stats
  | { count: number } // creators
  | { count: number; slugs: string[] } // tags
  | { mode: "image" | "html"; image: string; link: string; alt: string; html: string; badge: boolean }; // ad

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
  const schema = homeConfigSchemas[kind];
  const r = schema.safeParse(obj);
  return r.success ? (r.data as HomeSectionConfig) : (schema.parse({}) as HomeSectionConfig);
}

/** 保存前校验编辑面板提交的 config，返回规范化结果 */
export function safeHomeConfig(
  kind: HomeSectionKind,
  value: unknown
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
  { kind: "hero", title: null, order: 10, enabled: true, config: { featuredIds: [] } },
  { kind: "categories", title: "按分类探索", order: 20, enabled: true, config: { slugs: [] } },
  { kind: "feed", title: null, order: 30, enabled: true, config: { showTags: false } },
  { kind: "tags", title: "热门标签", order: 40, enabled: false, config: { count: 12, slugs: [] } },
  { kind: "creators", title: "人气创作者", order: 50, enabled: false, config: { count: 6 } },
  { kind: "stats", title: "社区数据", order: 60, enabled: false, config: {} },
];
