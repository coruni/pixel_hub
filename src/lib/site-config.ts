// 站点外观配置 —— 纯数据/校验层（不依赖 server，可被前后端与 seed 共用）。
// 主题文档（存于 SiteSetting["theme"]，JSON 文本）：侧边栏系统 + 详情页模板默认。
// 结构：
// {
//   sidebar: { showOn:{home,archive,detail}, sticky, width, widgets:[SidebarWidget] },
//   detailTemplate: { default, byType? }
// }
import { z } from "zod";
import type { ContentDisplay, ContentType } from "./display";

export const THEME_KEY = "theme";

// ---------- 详情页模板 ----------

export type DetailTemplateId = "post" | "banner" | "twocol" | "article";

export const DETAIL_TEMPLATE_IDS: DetailTemplateId[] = ["post", "banner", "twocol", "article"];

export const DETAIL_TEMPLATE_META: Record<
  DetailTemplateId,
  { label: string; desc: string }
> = {
  post: { label: "居中图帖式", desc: "主图/画廊居中，标题摘要在上、长描述与评论随后，适合图片作品阅读" },
  banner: { label: "顶栏横幅式", desc: "顶部封面 + 关键信息横幅，下方接内容图集与描述，适合游戏" },
  twocol: { label: "左右两栏式", desc: "左画廊右信息（近似早期版本），信息紧凑" },
  article: { label: "杂志阅读式", desc: "编辑部排版：左对齐大标题 + 作者行 + 阅读列正文，适合文章" },
};

// ---------- 侧边栏 widget 类型 ----------

export type SidebarWidgetKind =
  | "hot"
  | "categories"
  | "tags"
  | "creators"
  | "stats"
  | "about"
  | "comments"
  | "random"
  | "notice"
  | "custom";

export const SIDEBAR_WIDGET_KINDS: SidebarWidgetKind[] = [
  "hot",
  "categories",
  "tags",
  "creators",
  "stats",
  "about",
  "comments",
  "random",
  "notice",
  "custom",
];

export const SIDEBAR_KIND_META: Record<
  SidebarWidgetKind,
  { label: string; desc: string; defaultTitle: string | null }
> = {
  hot: { label: "内容排行", desc: "最新 / 最热 / 最多下载 的短列表", defaultTitle: "热门内容" },
  categories: { label: "分类入口", desc: "按大类或手动挑选的分类直达链接", defaultTitle: "分类直达" },
  tags: { label: "标签云", desc: "热门标签，或手动挑选的标签", defaultTitle: "热门标签" },
  creators: { label: "人气创作者", desc: "按粉丝数展示创作者", defaultTitle: "人气创作者" },
  stats: { label: "站点数据", desc: "社区规模数字小览", defaultTitle: "社区数据" },
  about: { label: "站点说明", desc: "一段自定义文字（简介/公告/指引）", defaultTitle: "关于本站" },
  comments: { label: "最新评论", desc: "全站最新评论流（头像+摘要+来源资源），透出社区活跃度", defaultTitle: "最新评论" },
  random: { label: "随机推荐", desc: "每次刷新随机抽几张已上架内容，「手气不错」探索位", defaultTitle: "手气不错" },
  notice: { label: "公告栏", desc: "醒目公告卡：多条公告，每条可选 普通/重要/活动 风格", defaultTitle: "公告" },
  custom: {
    label: "自定义内容",
    desc: "自由内容卡片：Markdown 富文本 + 可选链接列表，可展示公告/指引/任意信息",
    defaultTitle: null,
  },
};

// ---------- 各类 widget 的 config ----------
// 缺省值均为安全默认，坏数据在 parseSidebarConfig 内兜底。

const hotCfg = z.object({
  type: z.enum(["ALL", "IMAGE", "GAME", "ARTICLE"]).default("ALL"),
  sort: z.enum(["latest", "popular", "downloads"]).default("popular"),
  count: z.number().int().min(3).max(12).default(6),
  display: z.enum(["card", "list", "masonry"]).default("list"),
});
const categoriesCfg = z.object({
  slugs: z.array(z.string()).max(30).default([]), // 空 = 展示全部分类；否则仅展示所选分类
});
const tagsCfg = z.object({
  count: z.number().int().min(4).max(24).default(10),
  slugs: z.array(z.string()).max(30).default([]), // 空 = 按热度 top count；否则仅展示所选标签
});
const creatorsCfg = z.object({
  count: z.number().int().min(1).max(6).default(3),
});
const statsCfg = z.object({});
const aboutCfg = z.object({
  text: z.string().max(600).default(""),
});
const commentsCfg = z.object({
  count: z.number().int().min(3).max(10).default(5),
});
const randomCfg = z.object({
  count: z.number().int().min(2).max(8).default(4),
});
export const NOTICE_LEVELS = ["info", "warn", "event"] as const;
export type NoticeLevel = (typeof NOTICE_LEVELS)[number];
const noticeCfg = z.object({
  items: z
    .array(
      z.object({
        level: z.enum(NOTICE_LEVELS).default("info"),
        text: z.string().trim().min(1).max(200),
      })
    )
    .max(10)
    .default([]), // 空数组 = 不渲染
});
const customCfg = z.object({
  content: z.string().max(8000).default(""), // Markdown 富文本
  links: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        href: z.string().trim().min(1).max(300),
      })
    )
    .max(20)
    .default([]), // 结构化链接行（http(s):// 自动新窗口）
});

export const sidebarConfigSchemas: Record<SidebarWidgetKind, z.ZodTypeAny> = {
  hot: hotCfg,
  categories: categoriesCfg,
  tags: tagsCfg,
  creators: creatorsCfg,
  stats: statsCfg,
  about: aboutCfg,
  comments: commentsCfg,
  random: randomCfg,
  notice: noticeCfg,
  custom: customCfg,
};

export type SidebarWidgetConfig =
  | { type: "ALL" | ContentType; sort: "latest" | "popular" | "downloads"; count: number; display: ContentDisplay } // hot
  | { slugs: string[] } // categories
  | { count: number; slugs: string[] } // tags
  | { count: number } // creators
  | Record<string, never> // stats
  | { text: string } // about
  | { count: number } // comments
  | { count: number } // random
  | { items: { level: NoticeLevel; text: string }[] } // notice
  | { content: string; links: { label: string; href: string }[] }; // custom

export type SidebarWidget = {
  id: string;
  kind: SidebarWidgetKind;
  title: string | null;
  enabled: boolean;
  config: SidebarWidgetConfig;
};

/** 从 JSON 文本/对象解析为已校验 config（坏数据兜底为默认值） */
export function parseSidebarConfig(kind: SidebarWidgetKind, value: unknown): SidebarWidgetConfig {
  const schema = sidebarConfigSchemas[kind];
  if (!schema) return {} as SidebarWidgetConfig;
  const r = schema.safeParse(value ?? {});
  return r.success ? (r.data as SidebarWidgetConfig) : (schema.parse({}) as SidebarWidgetConfig);
}

/** 保存前校验 widget 提交的 config */
export function safeSidebarConfig(
  kind: SidebarWidgetKind,
  value: unknown
): { ok: true; data: SidebarWidgetConfig } | { ok: false; error: string } {
  const schema = sidebarConfigSchemas[kind];
  const r = schema.safeParse(value);
  if (r.success) return { ok: true, data: r.data as SidebarWidgetConfig };
  return { ok: false, error: r.error.issues[0]?.message ?? "配置不合法" };
}

function parseWidget(raw: unknown): SidebarWidget | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind as SidebarWidgetKind;
  if (typeof kind !== "string" || !(SIDEBAR_WIDGET_KINDS as string[]).includes(kind)) return null;
  const id = typeof o.id === "string" && o.id ? (o.id as string) : `sw-${kind}-${(o._i as string) ?? ""}`;
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 80) : null;
  const enabled = typeof o.enabled === "boolean" ? o.enabled : true;
  return { id, kind, title, enabled, config: parseSidebarConfig(kind, o.config) };
}

export function parseNavItem(raw: unknown): NavItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id ? (o.id as string) : `nav-${(o.label as string) ?? ""}-${(o.href as string) ?? ""}`;
  const label = typeof o.label === "string" ? o.label.trim().slice(0, 24) : "";
  const href = typeof o.href === "string" ? o.href.trim().slice(0, 300) : "";
  const internal = href.startsWith("/");
  const external = /^https?:\/\//i.test(href);
  if (!label || (!internal && !external)) return null;
  const icon = typeof o.icon === "string" && (NAV_ICONS as readonly string[]).includes(o.icon) ? o.icon : null;
  const showTo = typeof o.showTo === "string" && (NAV_VISIBILITY_KEYS as string[]).includes(o.showTo) ? (o.showTo as NavVisibility) : "all";
  return {
    id,
    label,
    href,
    icon,
    newTab: typeof o.newTab === "boolean" ? o.newTab : false,
    showTo,
    enabled: typeof o.enabled === "boolean" ? o.enabled : true,
  };
}

// ---------- 顶部导航栏 ----------

export type NavVisibility = "all" | "guest" | "user" | "staff";

export const NAV_VISIBILITY_KEYS: NavVisibility[] = ["all", "guest", "user", "staff"];

export const NAV_VISIBILITY_LABELS: Record<NavVisibility, string> = {
  all: "所有人",
  guest: "仅未登录",
  user: "仅登录用户",
  staff: "仅管理/版主",
};

/** 可配置的导航图标（白名单，未知值渲染为纯文本） */
export const NAV_ICONS = ["home", "compass", "upload", "bell", "shield", "tag", "bookmark", "external", "info"] as const;

export type NavItem = {
  id: string;
  label: string;
  href: string; // 站内绝对路径（/x）或完整 http(s):// 外链
  icon: string | null;
  newTab: boolean;
  showTo: NavVisibility;
  enabled: boolean;
};

export const DEFAULT_NAV_ITEMS: NavItem[] = [
  { id: "nav-home", label: "首页", href: "/", icon: "home", newTab: false, showTo: "all", enabled: true },
  { id: "nav-browse", label: "浏览", href: "/browse", icon: "compass", newTab: false, showTo: "all", enabled: true },
  { id: "nav-upload", label: "发布", href: "/upload", icon: "upload", newTab: false, showTo: "user", enabled: true },
  { id: "nav-notify", label: "通知", href: "/notifications", icon: "bell", newTab: false, showTo: "user", enabled: true },
  { id: "nav-admin", label: "管理", href: "/admin", icon: "shield", newTab: false, showTo: "staff", enabled: true },
];

// ---------- 主题文档（Theme） ----------

export type CategoriesMenuCfg = {
  enabled: boolean;
  label: string;
};

export type Theme = {
  navbar: {
    items: NavItem[];
    categoriesMenu: CategoriesMenuCfg;
  };
  sidebar: {
    showOn: { home: boolean; archive: boolean; detail: boolean };
    sticky: boolean;
    width: number;
    widgets: SidebarWidget[];
  };
  detailTemplate: {
    default: DetailTemplateId;
    byType: Partial<Record<ContentType, DetailTemplateId>>;
  };
};

export function widgetTitle(w: SidebarWidget): string {
  return w.title || SIDEBAR_KIND_META[w.kind].defaultTitle || SIDEBAR_KIND_META[w.kind].label;
}

/** 某类页面是否应展示侧边栏：该页开关开启 且 至少有一个启用的 widget */
export function sidebarVisible(
  theme: Theme,
  page: keyof Theme["sidebar"]["showOn"]
): boolean {
  return theme.sidebar.showOn[page] && theme.sidebar.widgets.some((w) => w.enabled);
}

function clampWidth(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 320;
  return Math.max(260, Math.min(420, n));
}

export const DEFAULT_SIDEBAR_WIDGETS: SidebarWidget[] = [
  {
    id: "sw-hot",
    kind: "hot",
    title: "热门内容",
    enabled: true,
    config: { type: "ALL", sort: "popular", count: 6, display: "list" },
  },
  {
    id: "sw-cats",
    kind: "categories",
    title: "分类直达",
    enabled: true,
    config: { slugs: [] },
  },
  {
    id: "sw-tags",
    kind: "tags",
    title: "热门标签",
    enabled: true,
    config: { count: 10, slugs: [] },
  },
  {
    id: "sw-creators",
    kind: "creators",
    title: "人气创作者",
    enabled: false,
    config: { count: 3 },
  },
];

export const DEFAULT_THEME: Theme = {
  navbar: {
    items: DEFAULT_NAV_ITEMS.map((x) => ({ ...x })),
    categoriesMenu: { enabled: false, label: "分类" },
  },
  sidebar: {
    showOn: { home: true, archive: true, detail: true },
    sticky: true,
    width: 320,
    widgets: DEFAULT_SIDEBAR_WIDGETS.map((w) => ({ ...w, config: { ...w.config } })),
  },
  detailTemplate: {
    default: "post",
    byType: { GAME: "banner", IMAGE: "post", ARTICLE: "article" },
  },
};

const VALID_TEMPLATES = DETAIL_TEMPLATE_IDS as string[];

/** 从 SiteSetting 的 JSON 文本解析为完整 Theme（null/坏数据兜底为默认），绝不抛错 */
export function parseTheme(raw: unknown): Theme {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sb = (o.sidebar && typeof o.sidebar === "object" ? o.sidebar : {}) as Record<string, unknown>;
  const so = (sb.showOn && typeof sb.showOn === "object" ? sb.showOn : {}) as Record<string, unknown>;
  const dt = (o.detailTemplate && typeof o.detailTemplate === "object" ? o.detailTemplate : {}) as Record<string, unknown>;

  const widgetsRaw = sb.widgets;
  const widgets: SidebarWidget[] = Array.isArray(widgetsRaw)
    ? widgetsRaw.map(parseWidget).filter((w): w is SidebarWidget => w !== null)
    : DEFAULT_SIDEBAR_WIDGETS.map((w) => ({ ...w, config: { ...w.config } }));

  const pickTemplate = (v: unknown, fallback: DetailTemplateId): DetailTemplateId =>
    typeof v === "string" && (VALID_TEMPLATES as string[]).includes(v) ? (v as DetailTemplateId) : fallback;

  const byTypeRaw = (dt.byType && typeof dt.byType === "object" ? dt.byType : {}) as Record<string, unknown>;
  const defaultTpl = pickTemplate(dt.default, DEFAULT_THEME.detailTemplate.default);
  // byType 缺省时并入内置默认（GAME→banner 等），保证未显式覆盖也能按类型差异出版式
  const byImage = DEFAULT_THEME.detailTemplate.byType.IMAGE ?? defaultTpl;
  const byGame = DEFAULT_THEME.detailTemplate.byType.GAME ?? defaultTpl;
  const byArticle = DEFAULT_THEME.detailTemplate.byType.ARTICLE ?? defaultTpl;

  // 导航：坏数据/空列表回退内置默认
  const navRaw = (o.navbar && typeof o.navbar === "object" ? o.navbar : {}) as Record<string, unknown>;
  let navItems: NavItem[];
  if (Array.isArray(navRaw.items)) {
    const parsed = navRaw.items.map(parseNavItem).filter((x): x is NavItem => x !== null);
    navItems = parsed.length > 0 ? parsed : DEFAULT_NAV_ITEMS.map((x) => ({ ...x }));
  } else {
    navItems = DEFAULT_NAV_ITEMS.map((x) => ({ ...x }));
  }
  // 导航「分类」下拉菜单（旧文档缺省 = 关闭）
  const cmRaw = (navRaw.categoriesMenu && typeof navRaw.categoriesMenu === "object" ? navRaw.categoriesMenu : {}) as Record<string, unknown>;
  const categoriesMenu: CategoriesMenuCfg = {
    enabled: cmRaw.enabled === true,
    label: typeof cmRaw.label === "string" && cmRaw.label.trim() ? cmRaw.label.trim().slice(0, 12) : "分类",
  };

  return {
    navbar: { items: navItems, categoriesMenu },
    sidebar: {
      showOn: {
        home: typeof so.home === "boolean" ? so.home : true,
        archive: typeof so.archive === "boolean" ? so.archive : true,
        detail: typeof so.detail === "boolean" ? so.detail : true,
      },
      sticky: typeof sb.sticky === "boolean" ? sb.sticky : true,
      width: clampWidth(sb.width),
      widgets,
    },
    detailTemplate: {
      default: defaultTpl,
      byType: {
        IMAGE: byTypeRaw.IMAGE !== undefined ? pickTemplate(byTypeRaw.IMAGE, byImage) : byImage,
        GAME: byTypeRaw.GAME !== undefined ? pickTemplate(byTypeRaw.GAME, byGame) : byGame,
        ARTICLE: byTypeRaw.ARTICLE !== undefined ? pickTemplate(byTypeRaw.ARTICLE, byArticle) : byArticle,
      },
    },
  };
}

export function serializeTheme(t: Theme): string {
  return JSON.stringify(t);
}
