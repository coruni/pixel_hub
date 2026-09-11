// 站点外观配置 —— 纯数据/校验层（不依赖 server，可被前后端与 seed 共用）。
// 主题文档（存于 SiteSetting["theme"]，JSON 文本）：侧边栏系统 + 详情页模板默认。
// 结构：
// {
//   sidebar: { showOn:{home,archive,detail}, sticky, width, widgetsByPage:{home,archive,detail} },
//   slots: { detailTop, detailMiddle, detailBottom, archiveTop, archiveBottom },
//   detailTemplate: { default, byType? }
// }
import { z } from "zod";
import type { ContentDisplay, ContentType } from "./display";

export const THEME_KEY = "theme";

// ---------- 设备端可见性（服务端无法判断真实设备，用 Tailwind 响应式类实现） ----------
export type VisibleOn = "all" | "pc" | "mobile";
export const VISIBLE_ON_KEYS: VisibleOn[] = ["all", "pc", "mobile"];
export const VISIBLE_ON_LABELS: Record<VisibleOn, string> = {
  all: "全部设备",
  pc: "仅电脑端",
  mobile: "仅移动端",
};
/** 设备端可见性对应的响应式容器 class（服务端安全，无需 UA 嗅探） */
export function visibleOnClass(v?: string | null): string {
  if (v === "pc") return "hidden lg:block";
  if (v === "mobile") return "block lg:hidden";
  return "";
}

// ---------- 热门排序时间窗口（限定候选/热门池为近期发布） ----------
export type HotPeriod = "all" | "week" | "month";
export const HOT_PERIOD_KEYS: HotPeriod[] = ["all", "week", "month"];
export const HOT_PERIOD_LABELS: Record<HotPeriod, string> = {
  all: "全部时间",
  week: "近 7 天",
  month: "近 30 天",
};
/** 时间窗口对应的天数；all 返回 null（不限制） */
export function periodDays(p?: string | null): number | null {
  if (p === "week") return 7;
  if (p === "month") return 30;
  return null;
}
/** 转 getFeed 的 period 参数：all 返回 undefined（不限制） */
export function toFeedPeriod(p?: string | null): "week" | "month" | undefined {
  if (p === "week") return "week";
  if (p === "month") return "month";
  return undefined;
}

// ---------- 详情页模板 ----------

export type DetailTemplateId = "post" | "banner" | "twocol" | "article";

export const DETAIL_TEMPLATE_IDS: DetailTemplateId[] = ["post", "banner", "twocol", "article"];

export const DETAIL_TEMPLATE_META: Record<DetailTemplateId, { label: string; desc: string }> = {
  post: {
    label: "居中图帖式",
    desc: "主图/画廊居中，标题摘要在上、长描述与评论随后，适合图片作品阅读",
  },
  banner: { label: "顶栏横幅式", desc: "顶部封面 + 关键信息横幅，下方接内容图集与描述，适合游戏" },
  twocol: { label: "左右两栏式", desc: "左画廊右信息（近似早期版本），信息紧凑" },
  article: {
    label: "杂志阅读式",
    desc: "编辑部排版：左对齐大标题 + 作者行 + 阅读列正文，适合文章",
  },
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
  | "custom"
  | "authorWorks"
  | "sameCategory"
  | "ad";

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
  "authorWorks",
  "sameCategory",
  "ad",
];

/** 仅详情页侧边栏有渲染上下文的 widget kind（配到其它页不渲染） */
export const DETAIL_ONLY_KINDS: SidebarWidgetKind[] = ["authorWorks", "sameCategory"];

export const SIDEBAR_KIND_META: Record<
  SidebarWidgetKind,
  { label: string; desc: string; defaultTitle: string | null }
> = {
  hot: { label: "内容排行", desc: "最新 / 最热 / 最多下载 的短列表", defaultTitle: "热门内容" },
  categories: {
    label: "分类入口",
    desc: "按大类或手动挑选的分类直达链接",
    defaultTitle: "分类直达",
  },
  tags: { label: "标签云", desc: "热门标签，或手动挑选的标签", defaultTitle: "热门标签" },
  creators: { label: "人气创作者", desc: "按粉丝数展示创作者", defaultTitle: "人气创作者" },
  stats: { label: "站点数据", desc: "社区规模数字小览", defaultTitle: "社区数据" },
  about: { label: "站点说明", desc: "一段自定义文字（简介/公告/指引）", defaultTitle: "关于本站" },
  comments: {
    label: "最新评论",
    desc: "全站最新评论流（头像+摘要+来源资源），透出社区活跃度",
    defaultTitle: "最新评论",
  },
  random: {
    label: "随机推荐",
    desc: "每次刷新随机抽几张已上架内容，「手气不错」探索位",
    defaultTitle: "手气不错",
  },
  notice: {
    label: "公告栏",
    desc: "醒目公告卡：多条公告，每条可选 普通/重要/活动 风格",
    defaultTitle: "公告",
  },
  custom: {
    label: "自定义内容",
    desc: "自由内容卡片：Markdown 富文本 + 可选链接列表，可展示公告/指引/任意信息",
    defaultTitle: null,
  },
  authorWorks: {
    label: "作者其它作品",
    desc: "仅详情页生效：当前资源作者的其它作品（按热度）",
    defaultTitle: "作者其它作品",
  },
  sameCategory: {
    label: "同分类推荐",
    desc: "仅详情页生效：同分类其它内容，不足补同类型热门",
    defaultTitle: "同分类推荐",
  },
  ad: {
    label: "广告位",
    desc: "图片+链接 或 HTML/JS 代码片段（可接联盟广告），可放侧边栏或详情页槽位",
    defaultTitle: null,
  },
};

// ---------- 各类 widget 的 config ----------
// 缺省值均为安全默认，坏数据在 parseSidebarConfig 内兜底。

/** URL 白名单校验：http(s) 外链或站内 / 路径（拒绝 javascript: 等危险协议）；空串合法 */
export const safeUrlSchema = (max: number) =>
  z
    .string()
    .max(max)
    .default("")
    .refine((v) => !v || /^(https?:\/\/|\/)/i.test(v), "仅允许 http(s):// 或站内 / 路径");

const hotCfg = z.object({
  type: z.enum(["ALL", "IMAGE", "GAME", "ARTICLE"]).default("ALL"),
  sort: z.enum(["latest", "popular", "downloads"]).default("popular"),
  count: z.number().int().min(3).max(12).default(6),
  display: z.enum(["card", "list"]).default("list"),
  // 热度时间窗口：all=累计全时间；week/month=仅统计近期发布的资源
  period: z.enum(["all", "week", "month"]).default("all"),
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
      }),
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
        href: safeUrlSchema(300).refine((v) => !!v, "链接不能为空"),
      }),
    )
    .max(20)
    .default([]), // 结构化链接行（http(s):// 自动新窗口）
});
const authorWorksCfg = z.object({
  count: z.number().int().min(2).max(8).default(4),
  // 热度时间窗口：仅统计近期发布的作品（all=累计全时间）
  period: z.enum(["all", "week", "month"]).default("all"),
});
const sameCategoryCfg = z.object({
  count: z.number().int().min(2).max(8).default(4),
  // 热度时间窗口：仅统计近期发布的同分类内容（all=累计全时间）
  period: z.enum(["all", "week", "month"]).default("all"),
});
const adCfg = z.object({
  mode: z.enum(["image", "html"]).default("image"),
  image: safeUrlSchema(2000), // 图片 URL 或站内 /uploads 路径
  link: safeUrlSchema(500), // 点击跳转（可空 = 纯展示）
  alt: z.string().max(120).default(""),
  html: z.string().max(8000).default(""), // 任意 HTML/JS 片段（AdSense 等联盟广告）
  badge: z.boolean().default(true), // 是否显示「广告」角标
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
  authorWorks: authorWorksCfg,
  sameCategory: sameCategoryCfg,
  ad: adCfg,
};

export type SidebarWidgetConfig =
  | {
      type: "ALL" | ContentType;
      sort: "latest" | "popular" | "downloads";
      count: number;
      display: ContentDisplay;
      period: HotPeriod;
    } // hot
  | { slugs: string[] } // categories
  | { count: number; slugs: string[] } // tags
  | { count: number } // creators
  | Record<string, never> // stats
  | { text: string } // about
  | { count: number } // comments
  | { count: number } // random
  | { items: { level: NoticeLevel; text: string }[] } // notice
  | { content: string; links: { label: string; href: string }[] } // custom
  | { count: number; period: HotPeriod } // authorWorks / sameCategory
  | {
      mode: "image" | "html";
      image: string;
      link: string;
      alt: string;
      html: string;
      badge: boolean;
    }; // ad

export type SidebarWidgetTier = "primary" | "more";

export type SidebarWidget = {
  id: string;
  kind: SidebarWidgetKind;
  title: string | null;
  enabled: boolean;
  /** 层级：primary 常驻直出；more 收进侧栏底部「更多」折叠组，避免一栏过长 */
  tier?: SidebarWidgetTier;
  /** 设备端可见性：all=不限 / pc=仅电脑端 / mobile=仅移动端 */
  visibleOn?: VisibleOn;
  /** 是否仅登录用户可见 */
  requireAuth?: boolean;
  config: SidebarWidgetConfig;
};

/** 从 JSON 文本/对象解析为已校验 config（坏数据兜底为默认值） */
export function parseSidebarConfig(kind: SidebarWidgetKind, value: unknown): SidebarWidgetConfig {
  const schema = sidebarConfigSchemas[kind];
  if (!schema) return {} as SidebarWidgetConfig;
  // 存量迁移：hot 的 display="masonry" 已下线 → 字段级归一到 "card"（与旧「小瀑布」同款紧凑卡），保住 type/sort/count
  if (kind === "hot" && value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (o.display === "masonry") o.display = "card";
  }
  const r = schema.safeParse(value ?? {});
  return r.success ? (r.data as SidebarWidgetConfig) : (schema.parse({}) as SidebarWidgetConfig);
}

/** 保存前校验 widget 提交的 config */
export function safeSidebarConfig(
  kind: SidebarWidgetKind,
  value: unknown,
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
  const id =
    typeof o.id === "string" && o.id ? (o.id as string) : `sw-${kind}-${(o._i as string) ?? ""}`;
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 80) : null;
  const enabled = typeof o.enabled === "boolean" ? o.enabled : true;
  const tier = o.tier === "more" ? "more" : "primary";
  const visibleOn = o.visibleOn === "pc" || o.visibleOn === "mobile" ? o.visibleOn : "all";
  const requireAuth = o.requireAuth === true;
  return {
    id,
    kind,
    title,
    enabled,
    tier,
    visibleOn,
    requireAuth,
    config: parseSidebarConfig(kind, o.config),
  };
}

export function parseNavItem(raw: unknown): NavItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id =
    typeof o.id === "string" && o.id
      ? (o.id as string)
      : `nav-${(o.label as string) ?? ""}-${(o.href as string) ?? ""}`;
  const label = typeof o.label === "string" ? o.label.trim().slice(0, 24) : "";
  const href = typeof o.href === "string" ? o.href.trim().slice(0, 300) : "";
  const internal = href.startsWith("/");
  const external = /^https?:\/\//i.test(href);
  if (!label || (!internal && !external)) return null;
  const icon =
    typeof o.icon === "string" && (NAV_ICONS as readonly string[]).includes(o.icon) ? o.icon : null;
  const showTo =
    typeof o.showTo === "string" && (NAV_VISIBILITY_KEYS as string[]).includes(o.showTo)
      ? (o.showTo as NavVisibility)
      : "all";
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
export const NAV_ICONS = [
  "home",
  "compass",
  "upload",
  "bell",
  "shield",
  "tag",
  "bookmark",
  "external",
  "info",
] as const;

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
  {
    id: "nav-home",
    label: "首页",
    href: "/",
    icon: "home",
    newTab: false,
    showTo: "all",
    enabled: true,
  },
  {
    id: "nav-browse",
    label: "浏览",
    href: "/browse",
    icon: "compass",
    newTab: false,
    showTo: "all",
    enabled: true,
  },
  {
    id: "nav-upload",
    label: "发布",
    href: "/upload",
    icon: "upload",
    newTab: false,
    showTo: "user",
    enabled: true,
  },
  {
    id: "nav-notify",
    label: "通知",
    href: "/notifications",
    icon: "bell",
    newTab: false,
    showTo: "user",
    enabled: true,
  },
  {
    id: "nav-admin",
    label: "管理",
    href: "/admin",
    icon: "shield",
    newTab: false,
    showTo: "staff",
    enabled: true,
  },
];

// ---------- 主题文档（Theme） ----------

export type CategoriesMenuCfg = {
  enabled: boolean;
  label: string;
};

/** 侧边栏页面分组：首页 / 归档页(浏览·搜索·标签) / 资源详情页 */
export type SidebarPageKey = "home" | "archive" | "detail";

export const SIDEBAR_PAGE_KEYS: SidebarPageKey[] = ["home", "archive", "detail"];

/** 详情页正文槽位：上（正文前）/ 中（描述与评论之间）/ 下（页尾） */
export type DetailSlotKey = "detailTop" | "detailMiddle" | "detailBottom";

/** 归档页正文槽位：上（内容流之前）/ 下（内容流之后）——动态信息流无固定中部；首页板块流在站点布局页的「首页布局」区管理，无槽位 */
export type FeedSlotKey = "archiveTop" | "archiveBottom";

/** 全部内容槽位 key */
export type ContentSlotKey = DetailSlotKey | FeedSlotKey;

export const CONTENT_SLOT_KEYS: ContentSlotKey[] = [
  "detailTop",
  "detailMiddle",
  "detailBottom",
  "archiveTop",
  "archiveBottom",
];

/** 组件可投放的全部区域：3 个侧边栏页面 + 5 个内容槽位 */
export type WidgetAreaKey = SidebarPageKey | ContentSlotKey;

export const WIDGET_AREA_KEYS: WidgetAreaKey[] = [...SIDEBAR_PAGE_KEYS, ...CONTENT_SLOT_KEYS];

export type Theme = {
  navbar: {
    items: NavItem[];
    categoriesMenu: CategoriesMenuCfg;
  };
  sidebar: {
    showOn: Record<SidebarPageKey, boolean>;
    sticky: boolean;
    width: number;
    /** 每类页面独立一套组件 */
    widgetsByPage: Record<SidebarPageKey, SidebarWidget[]>;
  };
  /** 内容槽位组件（详情页上/中/下 + 归档页上/下） */
  slots: Record<ContentSlotKey, SidebarWidget[]>;
  detailTemplate: {
    default: DetailTemplateId;
    byType: Partial<Record<ContentType, DetailTemplateId>>;
  };
};

/** 读取某区域的组件列表（侧边栏页面或内容槽位） */
export function getAreaWidgets(theme: Theme, area: WidgetAreaKey): SidebarWidget[] {
  return (CONTENT_SLOT_KEYS as string[]).includes(area)
    ? theme.slots[area as ContentSlotKey]
    : theme.sidebar.widgetsByPage[area as SidebarPageKey];
}

/** 返回替换了指定区域列表的新 Theme（不可变更新） */
export function withAreaWidgets(theme: Theme, area: WidgetAreaKey, list: SidebarWidget[]): Theme {
  if ((CONTENT_SLOT_KEYS as string[]).includes(area)) {
    return { ...theme, slots: { ...theme.slots, [area]: list } };
  }
  const page = area as SidebarPageKey;
  return {
    ...theme,
    sidebar: { ...theme.sidebar, widgetsByPage: { ...theme.sidebar.widgetsByPage, [page]: list } },
  };
}

export function widgetTitle(w: SidebarWidget): string {
  return w.title || SIDEBAR_KIND_META[w.kind].defaultTitle || SIDEBAR_KIND_META[w.kind].label;
}

/** 某类页面是否应展示侧边栏：该页开关开启 且 该页至少有一个启用的 widget */
export function sidebarVisible(theme: Theme, page: SidebarPageKey): boolean {
  return theme.sidebar.showOn[page] && theme.sidebar.widgetsByPage[page].some((w) => w.enabled);
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
    config: { type: "ALL", sort: "popular", count: 6, display: "list", period: "all" },
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
    tier: "more",
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

/** 详情页默认：两个上下文组件 + 热门兜底 */
export const DEFAULT_DETAIL_WIDGETS: SidebarWidget[] = [
  {
    id: "sw-detail-author-works",
    kind: "authorWorks",
    title: null,
    enabled: true,
    config: { count: 4, period: "all" },
  },
  {
    id: "sw-detail-same-category",
    kind: "sameCategory",
    title: null,
    enabled: true,
    config: { count: 4, period: "all" },
  },
  {
    id: "sw-detail-hot",
    kind: "hot",
    title: "热门内容",
    enabled: true,
    config: { type: "ALL", sort: "popular", count: 6, display: "list", period: "all" },
  },
];

function cloneWidgets(list: SidebarWidget[]): SidebarWidget[] {
  return list.map((w) => ({ ...w, config: { ...w.config } }));
}

export const DEFAULT_THEME: Theme = {
  navbar: {
    items: DEFAULT_NAV_ITEMS.map((x) => ({ ...x })),
    categoriesMenu: { enabled: false, label: "分类" },
  },
  sidebar: {
    showOn: { home: true, archive: true, detail: true },
    sticky: true,
    width: 320,
    widgetsByPage: {
      home: cloneWidgets(DEFAULT_SIDEBAR_WIDGETS),
      archive: cloneWidgets(DEFAULT_SIDEBAR_WIDGETS),
      detail: cloneWidgets(DEFAULT_DETAIL_WIDGETS),
    },
  },
  slots: {
    detailTop: [],
    detailMiddle: [],
    detailBottom: [],
    archiveTop: [],
    archiveBottom: [],
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
  const sb = (o.sidebar && typeof o.sidebar === "object" ? o.sidebar : {}) as Record<
    string,
    unknown
  >;
  const so = (sb.showOn && typeof sb.showOn === "object" ? sb.showOn : {}) as Record<
    string,
    unknown
  >;
  const dt = (
    o.detailTemplate && typeof o.detailTemplate === "object" ? o.detailTemplate : {}
  ) as Record<string, unknown>;

  const wbpRaw = (
    sb.widgetsByPage && typeof sb.widgetsByPage === "object" ? sb.widgetsByPage : null
  ) as Record<string, unknown> | null;

  const parseList = (raw: unknown): SidebarWidget[] | null =>
    Array.isArray(raw) ? raw.map(parseWidget).filter((w): w is SidebarWidget => w !== null) : null;

  // 兼容旧结构（全站单列表 widgets）：迁移时复制到三个页面
  const legacy = parseList(sb.widgets);
  const pageWidgets = (key: SidebarPageKey): SidebarWidget[] =>
    parseList(wbpRaw?.[key]) ?? legacy ?? cloneWidgets(DEFAULT_THEME.sidebar.widgetsByPage[key]);

  // 内容槽位（详情上/中/下 + 首页/归档上/下），缺省空（不配置不显示）
  // 旧文档字段名 detailSlots（仅详情三槽）迁入 slots
  const slotsRaw = (
    o.slots && typeof o.slots === "object" ? o.slots : (o.detailSlots ?? {})
  ) as Record<string, unknown>;
  const slotWidgets = (key: ContentSlotKey): SidebarWidget[] => parseList(slotsRaw[key]) ?? [];

  const pickTemplate = (v: unknown, fallback: DetailTemplateId): DetailTemplateId =>
    typeof v === "string" && (VALID_TEMPLATES as string[]).includes(v)
      ? (v as DetailTemplateId)
      : fallback;

  const byTypeRaw = (dt.byType && typeof dt.byType === "object" ? dt.byType : {}) as Record<
    string,
    unknown
  >;
  const defaultTpl = pickTemplate(dt.default, DEFAULT_THEME.detailTemplate.default);
  // 文档里显式有 detailTemplate → 未覆盖的类型走「全局默认」（该选项真正生效）；
  // 完全没配过（新站/旧文档）才整体沿用内置按类型默认（GAME→banner 等差异版式）。
  const templateConfigured = o.detailTemplate !== undefined && typeof o.detailTemplate === "object";

  // 导航：坏数据/空列表回退内置默认
  const navRaw = (o.navbar && typeof o.navbar === "object" ? o.navbar : {}) as Record<
    string,
    unknown
  >;
  let navItems: NavItem[];
  if (Array.isArray(navRaw.items)) {
    const parsed = navRaw.items.map(parseNavItem).filter((x): x is NavItem => x !== null);
    navItems = parsed.length > 0 ? parsed : DEFAULT_NAV_ITEMS.map((x) => ({ ...x }));
  } else {
    navItems = DEFAULT_NAV_ITEMS.map((x) => ({ ...x }));
  }
  // 导航「分类」下拉菜单（旧文档缺省 = 关闭）
  const cmRaw = (
    navRaw.categoriesMenu && typeof navRaw.categoriesMenu === "object" ? navRaw.categoriesMenu : {}
  ) as Record<string, unknown>;
  const categoriesMenu: CategoriesMenuCfg = {
    enabled: cmRaw.enabled === true,
    label:
      typeof cmRaw.label === "string" && cmRaw.label.trim()
        ? cmRaw.label.trim().slice(0, 12)
        : "分类",
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
      widgetsByPage: {
        home: pageWidgets("home"),
        archive: pageWidgets("archive"),
        detail: pageWidgets("detail"),
      },
    },
    slots: {
      detailTop: slotWidgets("detailTop"),
      detailMiddle: slotWidgets("detailMiddle"),
      detailBottom: slotWidgets("detailBottom"),
      archiveTop: slotWidgets("archiveTop"),
      archiveBottom: slotWidgets("archiveBottom"),
    },
    detailTemplate: {
      default: defaultTpl,
      // 只保留显式覆盖过的类型（清除覆盖=跟随全局后不会被读取-回写复活，resolveDetailTemplate 兜底默认）；
      // 完全没配过 detailTemplate 的文档整体沿用内置按类型默认
      byType: templateConfigured
        ? {
            ...(typeof byTypeRaw.IMAGE === "string"
              ? { IMAGE: pickTemplate(byTypeRaw.IMAGE, defaultTpl) }
              : {}),
            ...(typeof byTypeRaw.GAME === "string"
              ? { GAME: pickTemplate(byTypeRaw.GAME, defaultTpl) }
              : {}),
            ...(typeof byTypeRaw.ARTICLE === "string"
              ? { ARTICLE: pickTemplate(byTypeRaw.ARTICLE, defaultTpl) }
              : {}),
          }
        : { ...DEFAULT_THEME.detailTemplate.byType },
    },
  };
}

export function serializeTheme(t: Theme): string {
  return JSON.stringify(t);
}
