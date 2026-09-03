"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
 BarChart3,
 Bell,
 Bookmark,
 ChevronDown,
 ChevronUp,
 Compass,
 ExternalLink,
 Eye,
 EyeOff,
 FileText,
 GripVertical,
 Home,
 Info,
 LayoutGrid,
 Megaphone,
 Menu,
 MessageSquare,
 Plus,
 ShieldCheck,
 Shuffle,
 Tag,
 Tags as TagsIcon,
 Trash2,
 TrendingUp,
 Upload,
 Users,
 type LucideIcon,
} from "lucide-react";
import type { ContentType } from "@/lib/display";
import {
 DETAIL_TEMPLATE_IDS,
 DETAIL_TEMPLATE_META,
 NAV_ICONS,
 NAV_VISIBILITY_KEYS,
 NAV_VISIBILITY_LABELS,
 SIDEBAR_KIND_META,
 SIDEBAR_WIDGET_KINDS,
 widgetTitle,
 type CategoriesMenuCfg,
 type DetailTemplateId,
 type NavItem,
 type SidebarWidget,
 type SidebarWidgetConfig,
 type SidebarWidgetKind,
 type Theme,
} from "@/lib/site-config";
import {
 addSidebarWidgetAction,
 removeSidebarWidgetAction,
 reorderSidebarWidgetsAction,
 setDetailTemplateAction,
 updateCategoriesMenuAction,
 updateNavbarAction,
 updateSidebarFlagsAction,
 updateSidebarWidgetAction,
} from "@/lib/actions/site";

export type SiteCategories = { slug: string; name: string }[];
export type SiteTags = { slug: string; name: string }[];

function KindIcon({ kind, size = 15 }: { kind: SidebarWidgetKind; size?: number }) {
 const map: Record<SidebarWidgetKind, typeof TrendingUp> = {
 hot: TrendingUp,
 categories: LayoutGrid,
 tags: TagsIcon,
 creators: Users,
 stats: BarChart3,
 about: Info,
 comments: MessageSquare,
 random: Shuffle,
 notice: Megaphone,
 custom: FileText,
 };
 const Icon = map[kind] ?? TrendingUp;
 return <Icon size={size} aria-hidden />;
}

// 导航图标预览映射（与 lib/site-config 的 NAV_ICONS key 一一对应，供后台展示真实图标）
const ICON_OPTIONS: Record<string, LucideIcon> = {
 home: Home,
 compass: Compass,
 upload: Upload,
 bell: Bell,
 shield: ShieldCheck,
 tag: Tag,
 bookmark: Bookmark,
 external: ExternalLink,
 info: Info,
};

export default function SiteLayoutManager({
 theme: initial,
 categories,
 tags,
}: {
 theme: Theme;
 categories: SiteCategories;
 tags: SiteTags;
}) {
 const router = useRouter();
 const [theme, setTheme] = useState(initial);
 const [prev, setPrev] = useState(initial);
 const [editingId, setEditingId] = useState<string | null>(null);
 const [pending, start] = useTransition();

 // 服务端 refresh 后以最新 props 为准（渲染期派生 state，避免 effect 内 setState）
 if (prev !== initial) {
 setPrev(initial);
 setTheme(initial);
 }

 const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
 start(async () => {
 const r = await fn();
 if (!r.ok) window.alert(r.error ?? "操作失败");
 else router.refresh();
 });

 const widgets = theme.sidebar.widgets;

 function moveBy(index: number, delta: number) {
 const target = index + delta;
 if (target < 0 || target >= widgets.length) return;
 const next = [...widgets];
 const [m] = next.splice(index, 1);
 next.splice(target, 0, m);
 setTheme({ ...theme, sidebar: { ...theme.sidebar, widgets: next } });
 run(() => reorderSidebarWidgetsAction(next.map((w) => w.id)));
 }

 return (
 <div className="space-y-6">
 {/* 顶部导航栏 */}
 <NavbarCard items={theme.navbar.items} menu={theme.navbar.categoriesMenu} run={run} pending={pending} />

 {/* 详情模板 */}
 <DetailTemplateCard theme={theme} run={run} />

 {/* 侧边栏范围与外观 */}
 <FlagsCard theme={theme} pending={pending} run={run} />

 {/* 侧边栏组件 */}
 <section className="rounded-none border border-brand-200 bg-surface p-5">
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-base font-semibold text-neutral-900">侧边栏组件</h2>
 <p className="mt-0.5 text-xs text-neutral-500">
 这些组件在开启侧边栏的页面上按顺序渲染；可上移/下移排序、开关与删除。
 </p>
 </div>
 <Link href="/" className="text-sm text-neutral-600 hover:text-neutral-900 hover:underline">
 预览 →（首页）
 </Link>
 </div>

 {widgets.length === 0 ? (
 <p className="mt-4 rounded-none border-2 border-dashed border-brand-300 bg-brand-50/40 px-4 py-8 text-center text-sm text-neutral-400">
 暂无组件，从下方添加一个。
 </p>
 ) : (
 <ul className="mt-4 space-y-2">
 {widgets.map((w, index) => (
 <li key={w.id} className="rounded-none border border-brand-200">
 <div className="flex items-center gap-3 px-3 py-2.5">
 <span className="cursor-grab text-neutral-300 active:cursor-grabbing" aria-hidden>
 <GripVertical size={16} />
 </span>
 <span
 className={`grid h-9 w-9 shrink-0 place-items-center rounded-none ${
 w.enabled ? "bg-brand-500 text-white" : "bg-neutral-100 text-neutral-400"
 }`}
 >
 <KindIcon kind={w.kind} />
 </span>
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-2">
 <span className="text-sm font-medium text-neutral-800">{widgetTitle(w)}</span>
 <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
 {SIDEBAR_KIND_META[w.kind].label}
 </span>
 {!w.enabled && <span className="rounded-none bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500">已停用</span>}
 </div>
 </div>
 <div className="flex shrink-0 items-center gap-1">
 <button
 type="button"
 disabled={pending || index === 0}
 onClick={() => moveBy(index, -1)}
 aria-label="上移"
 className="rounded-none p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30"
 >
 <ChevronUp size={15} />
 </button>
 <button
 type="button"
 disabled={pending || index === widgets.length - 1}
 onClick={() => moveBy(index, 1)}
 aria-label="下移"
 className="rounded-none p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30"
 >
 <ChevronDown size={15} />
 </button>
 <button
 type="button"
 disabled={pending}
 onClick={() => run(() => updateSidebarWidgetAction({ id: w.id, enabled: !w.enabled }))}
 aria-label={w.enabled ? "停用组件" : "启用组件"}
 className="rounded-none p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30"
 >
 {w.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
 </button>
 <button
 type="button"
 disabled={pending}
 onClick={() => setEditingId(editingId === w.id ? null : w.id)}
 className={`rounded-none p-1.5 transition hover:bg-neutral-100 ${
 editingId === w.id ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-800"
 }`}
 >
 <span className="text-xs font-medium">编辑</span>
 </button>
 <button
 type="button"
 disabled={pending}
 onClick={() => {
 if (!window.confirm(`删除组件「${SIDEBAR_KIND_META[w.kind].label}」？`)) return;
 run(() => removeSidebarWidgetAction(w.id));
 }}
 aria-label="删除组件"
 className="rounded-none p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
 >
 <Trash2 size={15} />
 </button>
 </div>
 </div>

 {editingId === w.id && (
 <div className="border-t border-neutral-100 px-3 py-3">
 <WidgetEditor widget={w} categories={categories} tags={tags} onDone={() => setEditingId(null)} />
 </div>
 )}
 </li>
 ))}
 </ul>
 )}

 <div className="mt-5 rounded-none border-2 border-dashed border-brand-300 p-3">
 <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">添加组件</p>
 <div className="flex flex-wrap gap-2">
 {SIDEBAR_WIDGET_KINDS.map((kind) => (
 <button
 key={kind}
 type="button"
 disabled={pending}
 onClick={() => run(() => addSidebarWidgetAction(kind))}
 className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
 >
 <Plus size={12} />
 {SIDEBAR_KIND_META[kind].label}
 </button>
 ))}
 </div>
 </div>
 </section>
 </div>
 );
}

// ---------- 顶部导航栏编辑 ----------

function NavbarCard({
 items: initialItems,
 menu: initialMenu,
 run,
 pending,
}: {
 items: NavItem[];
 menu: CategoriesMenuCfg;
 run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
 pending: boolean;
}) {
 const [items, setItems] = useState(initialItems);
 const [prev, setPrev] = useState(initialItems);
 const [menu, setMenu] = useState(initialMenu);
 const [prevMenu, setPrevMenu] = useState(initialMenu);
 // 服务端 refresh 后同步（渲染期派生 state）
 if (prev !== initialItems) {
 setPrev(initialItems);
 setItems(initialItems);
 }
 if (prevMenu !== initialMenu) {
 setPrevMenu(initialMenu);
 setMenu(initialMenu);
 }
 const dirty =
 JSON.stringify(items) !== JSON.stringify(initialItems) || JSON.stringify(menu) !== JSON.stringify(initialMenu);
 const setAt = (i: number, patch: Partial<NavItem>) =>
 setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
 const move = (i: number, d: number) =>
 setItems((arr) => {
 const t = i + d;
 if (t < 0 || t >= arr.length) return arr;
 const next = [...arr];
 const [m] = next.splice(i, 1);
 next.splice(t, 0, m);
 return next;
 });
 const add = () =>
 setItems((arr) => [
 ...arr,
 { id: `nav-${Math.random().toString(36).slice(2, 8)}`, label: "新链接", href: "/", icon: null, newTab: false, showTo: "all", enabled: true },
 ]);

 const small = "rounded-none border border-brand-200 bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand-500";
 const iconBtn = "grid h-7 w-7 shrink-0 place-items-center rounded-none text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30";

 return (
 <section className="rounded-none border border-brand-200 bg-surface p-5">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Menu size={16} className="text-neutral-400" aria-hidden />
 <h2 className="text-base font-semibold text-neutral-900">顶部导航栏</h2>
 {dirty && <span className="rounded-none bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">有未保存修改</span>}
 </div>
 <button
 type="button"
 disabled={pending}
 onClick={() =>
 run(async () => {
 const r1 = await updateNavbarAction(items);
 if (!r1.ok) return r1;
 return updateCategoriesMenuAction(menu);
 })
 }
 className="rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
 >
 {pending ? "保存中…" : dirty ? "保存导航" : "已保存"}
 </button>
 </div>

 <div className="mt-4 space-y-1.5">
 {items.map((it, i) => {
 const Icon = it.icon ? (ICON_OPTIONS[it.icon] ?? null) : null;
 return (
 <div key={it.id} className="flex flex-wrap items-center gap-1.5 rounded-none border border-brand-200 px-2 py-1.5">
 <button type="button" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label="上移" className={iconBtn}>
 <ChevronUp size={14} />
 </button>
 <button type="button" disabled={pending || i === items.length - 1} onClick={() => move(i, 1)} aria-label="下移" className={iconBtn}>
 <ChevronDown size={14} />
 </button>
 <button
 type="button"
 disabled={pending}
 onClick={() => setAt(i, { enabled: !it.enabled })}
 aria-label={it.enabled ? "停用" : "启用"}
 className={iconBtn}
 >
 {it.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
 </button>
 <button
 type="button"
 disabled={pending}
 onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
 aria-label="删除"
 className={`${iconBtn} hover:bg-red-50 hover:text-red-500`}
 >
 <Trash2 size={14} />
 </button>

 <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-none ${it.enabled ? "bg-brand-500 text-white" : "bg-neutral-100 text-neutral-400"}`}>
 {Icon ? <Icon size={14} /> : <span className="text-[10px]">·</span>}
 </span>

 <input value={it.label} onChange={(e) => setAt(i, { label: e.target.value.slice(0, 24) })} placeholder="名称" className={`w-24 ${small}`} />
 <input
 value={it.href}
 onChange={(e) => setAt(i, { href: e.target.value.slice(0, 300) })}
 placeholder="/路径 或 https://外链"
 className={`min-w-40 flex-1 ${small}`}
 />
 <select value={it.icon ?? ""} onChange={(e) => setAt(i, { icon: e.target.value || null })} className={`w-28 ${small}`}>
 <option value="">无图标</option>
 {NAV_ICONS.map((ic) => (
 <option key={ic} value={ic}>
 {ic}
 </option>
 ))}
 </select>
 <select value={it.showTo} onChange={(e) => setAt(i, { showTo: e.target.value as NavItem["showTo"] })} className={`w-28 ${small}`}>
 {NAV_VISIBILITY_KEYS.map((v) => (
 <option key={v} value={v}>
 {NAV_VISIBILITY_LABELS[v]}
 </option>
 ))}
 </select>
 </div>
 );
 })}
 </div>

 <div className="mt-3 flex gap-2">
 <button type="button" disabled={pending} onClick={add} className="inline-flex items-center gap-1 rounded-none border border-brand-200 px-3 py-1.5 text-xs text-neutral-600 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50">
 <Plus size={12} /> 添加导航项
 </button>
 <span className="self-center text-[11px] text-neutral-400">外链需以 http(s):// 开头</span>
 </div>

 {/* 分类下拉菜单 */}
 <div className="mt-4 rounded-none border border-brand-200 bg-brand-50/40 p-3">
 <div className="flex flex-wrap items-center gap-2.5">
 <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800">
 <input
 type="checkbox"
 checked={menu.enabled}
 onChange={(e) => setMenu({ ...menu, enabled: e.target.checked })}
 className="h-4 w-4 accent-brand-500"
 />
 启用「分类」下拉菜单
 </label>
 <input
 value={menu.label}
 onChange={(e) => setMenu({ ...menu, label: e.target.value })}
 placeholder="菜单文字"
 className={`${small} w-28`}
 />
 <span className="text-[11px] text-neutral-400">在导航链接后渲染分类直达下拉</span>
 </div>
 </div>
 </section>
 );
}

// ---------- 侧边栏范围开关 ----------

const PAGE_LABELS: { key: "home" | "archive" | "detail"; label: string; hint: string }[] = [
 { key: "home", label: "首页", hint: "页面主内容（板块流）右侧" },
 { key: "archive", label: "归档页", hint: "浏览 / 搜索 / 标签页右侧" },
 { key: "detail", label: "资源详情", hint: "单资源详情页右侧" },
];

function FlagsCard({
 theme,
 pending,
 run,
}: {
 theme: Theme;
 pending: boolean;
 run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
 const [sticky, setSticky] = useState(theme.sidebar.sticky);
 const [width, setWidth] = useState(theme.sidebar.width);

 const commit = (patch: { sticky?: boolean; width?: number }) => {
 run(() => updateSidebarFlagsAction(patch));
 };

 return (
 <section className="rounded-none border border-brand-200 bg-surface p-5">
 <h2 className="text-base font-semibold text-neutral-900">侧边栏在哪些页面显示</h2>
 <div className="mt-3 grid gap-2 sm:grid-cols-3">
 {PAGE_LABELS.map((p) => {
 const on = theme.sidebar.showOn[p.key];
 return (
 <button
 key={p.key}
 type="button"
 disabled={pending}
 onClick={() => run(() => updateSidebarFlagsAction({ showOn: { [p.key]: !on } }))}
 className={`flex items-start gap-2 rounded-none border px-3.5 py-3 text-left transition disabled:opacity-50 ${
 on ? "border-brand-500 bg-brand-500 text-white" : "border-neutral-200 bg-surface hover:border-brand-500"
 }`}
 >
 <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-none border text-[10px] ${on ? "border-white bg-surface text-neutral-900" : "border-neutral-300 text-transparent"}`}>
 ✓
 </span>
 <span>
 <span className="block text-sm font-medium">{p.label}</span>
 <span className={`block text-xs ${on ? "text-white/70" : "text-neutral-400"}`}>{p.hint}</span>
 </span>
 </button>
 );
 })}
 </div>

 <div className="mt-4 flex flex-wrap items-end gap-5 border-t border-neutral-100 pt-4">
 <label className="flex items-center gap-2 text-sm text-neutral-700">
 <input
 type="checkbox"
 checked={sticky}
 disabled={pending}
 onChange={(e) => {
 setSticky(e.target.checked);
 commit({ sticky: e.target.checked });
 }}
 className="h-4 w-4 accent-brand-500"
 />
 侧边栏工具固定（sticky，随滚动吸附）
 </label>
 <label className="flex items-center gap-2 text-sm text-neutral-700">
 栏宽
 <input
 type="number"
 min={260}
 max={420}
 step={10}
 value={width}
 disabled={pending}
 onChange={(e) => setWidth(Number(e.target.value) || 320)}
 onBlur={() => {
 const w = Math.max(260, Math.min(420, width));
 setWidth(w);
 if (w !== theme.sidebar.width) commit({ width: w });
 }}
 className="w-20 rounded-none border border-brand-200 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
 />
 px
 </label>
 </div>
 </section>
 );
}

// ---------- 详情模板 ----------

function DetailTemplateCard({
 theme,
 run,
}: {
 theme: Theme;
 run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
 const rows: { scope: "default" | "IMAGE" | "GAME" | "ARTICLE"; label: string }[] = [
 { scope: "default", label: "全局默认" },
 { scope: "IMAGE", label: "图片作品覆盖" },
 { scope: "GAME", label: "游戏覆盖" },
 { scope: "ARTICLE", label: "文章覆盖" },
 ];
 const val = (scope: string): DetailTemplateId =>
 scope === "default" ? theme.detailTemplate.default : theme.detailTemplate.byType[scope as ContentType] ?? theme.detailTemplate.default;

 return (
 <section className="rounded-none border border-brand-200 bg-surface p-5">
 <h2 className="text-base font-semibold text-neutral-900">详情页模板</h2>
 <p className="mt-0.5 text-xs text-neutral-500">选择资源详情页的版式。单资源按「类型覆盖 &gt; 全局默认」生效；选择后立即保存。</p>
 <div className="mt-3 grid gap-3 sm:grid-cols-3">
 {rows.map((r) => (
 <label key={r.scope} className="block">
 <span className="mb-1.5 block text-xs font-medium text-neutral-500">{r.label}</span>
 <select
 value={val(r.scope)}
 onChange={(e) => run(() => setDetailTemplateAction({ scope: r.scope, value: e.target.value as DetailTemplateId }))}
 className="w-full rounded-none border border-brand-200 bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500"
 >
 {DETAIL_TEMPLATE_IDS.map((id) => (
 <option key={id} value={id}>
 {DETAIL_TEMPLATE_META[id].label}
 </option>
 ))}
 </select>
 <span className="mt-1 block text-[11px] text-neutral-400">{DETAIL_TEMPLATE_META[val(r.scope)].desc}</span>
 </label>
 ))}
 </div>
 </section>
 );
}

// ---------- 组件内联编辑 ----------

const fieldCls = "w-full rounded-none border border-brand-200 bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500";
const field = "mb-1 block text-xs font-medium text-neutral-500";
const rowField = "rounded-none border border-brand-200 bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand-500";

function WidgetEditor({
 widget,
 categories,
 tags,
 onDone,
}: {
 widget: SidebarWidget;
 categories: SiteCategories;
 tags: SiteTags;
 onDone: () => void;
}) {
 const kind = widget.kind;
 const cfg = widget.config as Record<string, unknown>;
 const [title, setTitle] = useState(widget.title ?? "");
 const [type, setType] = useState<"ALL" | ContentType>(cfg.type === "IMAGE" || cfg.type === "GAME" || cfg.type === "ARTICLE" ? cfg.type : "ALL");
 const [sort, setSort] = useState<"latest" | "popular" | "downloads">(
 cfg.sort === "latest" || cfg.sort === "downloads" ? cfg.sort : "popular"
 );
 const [count, setCount] = useState<number>(
 typeof cfg.count === "number"
 ? cfg.count
 : kind === "creators"
 ? 3
 : kind === "comments"
 ? 5
 : kind === "random"
 ? 4
 : 6
 );
 const [display, setDisplay] = useState<"card" | "list" | "masonry">(
 cfg.display === "card" || cfg.display === "masonry" ? cfg.display : "list"
 );
 const [cats, setCats] = useState<string[]>((cfg.slugs as string[]) ?? []);
 const [text, setText] = useState<string>(typeof cfg.text === "string" ? cfg.text : "");
 const [content, setContent] = useState<string>(typeof cfg.content === "string" ? cfg.content : "");
 const [links, setLinks] = useState<{ label: string; href: string }[]>(
 Array.isArray(cfg.links)
 ? (cfg.links as unknown[]).map((l) => {
 const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
 return { label: typeof o.label === "string" ? o.label : "", href: typeof o.href === "string" ? o.href : "" };
 })
 : []
 );
 const [notices, setNotices] = useState<{ level: string; text: string }[]>(
 Array.isArray(cfg.items)
 ? (cfg.items as unknown[]).map((l) => {
 const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
 return {
 level: typeof o.level === "string" && ["info", "warn", "event"].includes(o.level) ? o.level : "info",
 text: typeof o.text === "string" ? o.text : "",
 };
 })
 : []
 );
 const [msg, setMsg] = useState<string | null>(null);
 const [pending, start] = useTransition();

 const setLink = (i: number, key: "label" | "href", v: string) =>
 setLinks((arr) => arr.map((l, idx) => (idx === i ? { ...l, [key]: v } : l)));
 const setNotice = (i: number, key: "level" | "text", v: string) =>
 setNotices((arr) => arr.map((n, idx) => (idx === i ? { ...n, [key]: v } : n)));

 const catOptions = categories;

 function setTypeWithFilter(v: "ALL" | ContentType) {
 setType(v);
 }

 function buildConfig(): SidebarWidgetConfig {
 switch (kind) {
 case "hot":
 return { type, sort, count, display };
 case "categories":
 return { slugs: cats };
 case "tags":
 return { count, slugs: cats };
 case "creators":
 return { count };
 case "stats":
 return {};
 case "about":
 return { text };
 case "comments":
 return { count };
 case "random":
 return { count };
 case "notice":
 // 提交前剔除空行；level 白名单校验（坏值兜底 info）
 return {
 items: notices
 .map((n) => ({
 level: (["info", "warn", "event"] as string[]).includes(n.level) ? n.level : "info",
 text: n.text.trim().slice(0, 200),
 }))
 .filter((n) => n.text)
 .slice(0, 10) as { level: "info" | "warn" | "event"; text: string }[],
 };
 case "custom":
 // 提交前剔除空行（content 可为空 → 纯链接卡片；全空则保存后不渲染）
 return {
 content,
 links: links
 .map((l) => ({ label: l.label.trim(), href: l.href.trim() }))
 .filter((l) => l.label && l.href)
 .slice(0, 20),
 };
 }
 }

 function save() {
 start(async () => {
 const r = await updateSidebarWidgetAction({
 id: widget.id,
 title: title.trim() ? title.trim().slice(0, 80) : null,
 config: buildConfig(),
 });
 if (!r.ok) {
 setMsg(r.error ?? "保存失败");
 return;
 }
 onDone();
 });
 }

 return (
 <div className="rounded-none border border-brand-200 bg-neutral-50/60 p-4">
 <div className="grid gap-4 sm:grid-cols-2">
 <div className="sm:col-span-2">
 <label className={field}>组件标题（留空用默认）</label>
 <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={SIDEBAR_KIND_META[kind].defaultTitle ?? "标题…"} className={fieldCls} />
 </div>

 {kind === "hot" && (
 <>
 <div>
 <label className={field}>内容类型</label>
 <select value={type} onChange={(e) => setTypeWithFilter(e.target.value as "ALL" | ContentType)} className={fieldCls}>
 <option value="ALL">全部</option>
 <option value="IMAGE">图片作品</option>
 <option value="GAME">游戏</option>
 <option value="ARTICLE">文章</option>
 </select>
 </div>
 <div>
 <label className={field}>排序</label>
 <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={fieldCls}>
 <option value="popular">最热</option>
 <option value="latest">最新</option>
 <option value="downloads">最多下载</option>
 </select>
 </div>
 <div>
 <label className={field}>数量（3–12）</label>
 <input type="number" min={3} max={12} value={count} onChange={(e) => setCount(Math.max(3, Math.min(12, Number(e.target.value) || 3)))} className={fieldCls} />
 </div>
 <div>
 <label className={field}>显示形态</label>
 <select value={display} onChange={(e) => setDisplay(e.target.value as typeof display)} className={fieldCls}>
 <option value="list">列表行</option>
 <option value="card">小卡片</option>
 <option value="masonry">小瀑布</option>
 </select>
 </div>
 </>
 )}

 {(kind === "categories" || kind === "tags") && (
 <>
 <div className="sm:col-span-2">
 <label className={field}>
 {kind === "categories" ? "挑选要展示的分类（可多选；不选则全部）" : "挑选要展示的标签（可多选；不选则按热度）"}
 </label>
 {kind === "categories" ? (
 catOptions.length ? (
 <ChipPicker options={catOptions.map((c) => ({ key: c.slug, label: c.name }))} selected={cats} onChange={setCats} />
 ) : (
 <p className="text-xs text-neutral-400">该类下暂无分类</p>
 )
 ) : tags.length ? (
 <ChipPicker options={tags.map((t) => ({ key: t.slug, label: t.name }))} selected={cats} onChange={setCats} />
 ) : (
 <p className="text-xs text-neutral-400">暂无标签</p>
 )}
 </div>
 {kind === "tags" && (
 <div className="sm:col-span-2">
 <label className={field}>未挑选时按热度的数量（4–24）</label>
 <input type="number" min={4} max={24} value={count} onChange={(e) => setCount(Math.max(4, Math.min(24, Number(e.target.value) || 4)))} className={fieldCls} />
 </div>
 )}
 </>
 )}

 {kind === "creators" && (
 <div>
 <label className={field}>数量（1–6）</label>
 <input type="number" min={1} max={6} value={count} onChange={(e) => setCount(Math.max(1, Math.min(6, Number(e.target.value) || 1)))} className={fieldCls} />
 </div>
 )}

 {kind === "about" && (
 <div className="sm:col-span-2">
 <label className={field}>说明文字（支持换行；空则不显示）</label>
 <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={600} className={`${fieldCls} resize-y`} placeholder="一句话介绍站点/公告…" />
 </div>
 )}

 {kind === "comments" && (
 <div>
 <label className={field}>展示条数（3–10）</label>
 <input type="number" min={3} max={10} value={count} onChange={(e) => setCount(Math.max(3, Math.min(10, Number(e.target.value) || 3)))} className={fieldCls} />
 </div>
 )}

 {kind === "random" && (
 <div>
 <label className={field}>抽取数量（2–8）</label>
 <input type="number" min={2} max={8} value={count} onChange={(e) => setCount(Math.max(2, Math.min(8, Number(e.target.value) || 2)))} className={fieldCls} />
 </div>
 )}

 {kind === "notice" && (
 <div className="sm:col-span-2">
 <label className={field}>公告列表（最多 10 条；空内容不显示）</label>
 <div className="space-y-1.5">
 {notices.map((n, i) => (
 <div key={i} className="flex items-center gap-1.5">
 <select
 value={n.level}
 onChange={(e) => setNotice(i, "level", e.target.value)}
 className={`w-24 shrink-0 ${rowField}`}
 >
 <option value="info">普通</option>
 <option value="warn">重要</option>
 <option value="event">活动</option>
 </select>
 <input
 value={n.text}
 onChange={(e) => setNotice(i, "text", e.target.value.slice(0, 200))}
 placeholder="公告内容…"
 className={`min-w-0 flex-1 ${rowField}`}
 />
 <button
 type="button"
 onClick={() => setNotices((arr) => arr.filter((_, idx) => idx !== i))}
 aria-label="删除该公告"
 className="grid h-8 w-8 shrink-0 place-items-center rounded-none text-neutral-400 transition hover:bg-red-50 hover:text-red-500"
 >
 <Trash2 size={14} />
 </button>
 </div>
 ))}
 </div>
 {notices.length < 10 && (
 <button
 type="button"
 onClick={() => setNotices((arr) => [...arr, { level: "info", text: "" }])}
 className="mt-1.5 inline-flex items-center gap-1 rounded-none border border-brand-200 px-2.5 py-1 text-xs text-neutral-500 transition hover:border-brand-400 hover:text-brand-700"
 >
 <Plus size={12} /> 添加公告
 </button>
 )}
 </div>
 )}

 {kind === "custom" && (
 <>
 <div className="sm:col-span-2">
 <label className={field}>内容（Markdown）</label>
 <textarea
 value={content}
 onChange={(e) => setContent(e.target.value)}
 rows={8}
 maxLength={8000}
 className={`${fieldCls} resize-y font-mono text-xs leading-relaxed`}
 placeholder={"## 公告\n\n任意 markdown…\n\n- 要点一\n- 要点二"}
 />
 </div>
 <div className="sm:col-span-2">
 <label className={field}>链接列表（选填）</label>
 <div className="space-y-1.5">
 {links.map((l, i) => (
 <div key={i} className="flex items-center gap-1.5">
 <input
 value={l.label}
 onChange={(e) => setLink(i, "label", e.target.value.slice(0, 60))}
 placeholder="链接文字"
 className={`w-40 shrink-0 ${rowField}`}
 />
 <input
 value={l.href}
 onChange={(e) => setLink(i, "href", e.target.value.slice(0, 300))}
 placeholder="/路径 或 https://外链"
 className={`min-w-0 flex-1 ${rowField}`}
 />
 <button
 type="button"
 onClick={() => setLinks((arr) => arr.filter((_, idx) => idx !== i))}
 aria-label="删除该链接"
 className="grid h-8 w-8 shrink-0 place-items-center rounded-none text-neutral-400 transition hover:bg-red-50 hover:text-red-500"
 >
 <Trash2 size={14} />
 </button>
 </div>
 ))}
 </div>
 {links.length < 20 && (
 <button
 type="button"
 onClick={() => setLinks((arr) => [...arr, { label: "", href: "" }])}
 className="mt-1.5 inline-flex items-center gap-1 rounded-none border border-brand-200 px-2.5 py-1 text-xs text-neutral-500 transition hover:border-brand-400 hover:text-brand-700"
 >
 <Plus size={12} /> 添加链接
 </button>
 )}
 </div>
 </>
 )}

 {kind === "stats" && <p className="text-xs text-neutral-400">自动读取：上架内容 / 注册用户 / 累计下载 / 累计浏览，无需配置。</p>}
 </div>

 {msg && <p className="mt-2 text-xs text-red-500">{msg}</p>}
 <div className="mt-4 flex justify-end gap-2">
 <button type="button" onClick={onDone} className="rounded-none px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-200">
 取消
 </button>
 <button type="button" disabled={pending} onClick={save} className="rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50">
 {pending ? "保存中…" : "保存组件"}
 </button>
 </div>
 </div>
 );
}

function ChipPicker({
 options,
 selected,
 onChange,
}: {
 options: { key: string; label: string }[];
 selected: string[];
 onChange: (next: string[]) => void;
}) {
 const set = new Set(selected);
 return (
 <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto rounded-none border border-brand-200 bg-surface p-2">
 {options.map((o) => {
 const on = set.has(o.key);
 return (
 <button
 key={o.key}
 type="button"
 onClick={() => onChange(on ? selected.filter((s) => s !== o.key) : [...selected, o.key])}
 className={`rounded-none border px-2.5 py-1 text-xs transition ${
 on ? "border-brand-500 bg-brand-500 text-white" : "border-neutral-200 bg-surface text-neutral-600 hover:border-brand-500"
 }`}
 >
 {o.label}
 </button>
 );
 })}
 </div>
 );
}
