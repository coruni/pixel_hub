import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Bell, Calendar, Megaphone } from "lucide-react";
import { getCategories, getFeed, getTopTags } from "@/lib/queries";
import { getHomeStats, getTopCreators } from "@/lib/home";
import { widgetTitle, type SidebarWidget, type Theme } from "@/lib/site-config";
import type { FeedItem } from "@/lib/queries";
import { formatCount, timeAgo } from "@/lib/format";
import { prisma } from "@/lib/db/prisma";
import Markdown from "@/components/rte/Markdown";
import Avatar from "@/components/ui/Avatar";

// 站点级侧边栏：读 theme（已由页面加载）里启用的 widgets 渲染成可 sticky 的右栏。
// 开关位置见 lib/site-config.ts 的 sidebarVisible；sticky 由 theme.sidebar.sticky 控制。

const widgetCls =
 "rounded-none border border-brand-200 bg-surface p-4";

export default async function SiteSidebar({ theme }: { theme: Theme }) {
 const widgets = theme.sidebar.widgets.filter((w) => w.enabled);
 if (widgets.length === 0) return null;

 const nodes: ReactNode[] = [];
 for (let i = 0; i < widgets.length; i++) {
 const node = await renderWidget(widgets[i]);
 if (node) nodes.push(<Fragment key={`${widgets[i].kind}-${i}`}>{node}</Fragment>);
 }
 if (nodes.length === 0) return null;

 return (
 <aside
 className={`space-y-4 mt-6 ${
 theme.sidebar.sticky ? "sticky top-16 h-fit" : "h-fit"
 }`}
 >
 {nodes}
 </aside>
 );
}

function WidgetShell({ title, children }: { title: string; children: ReactNode }) {
 return (
 <section className={widgetCls}>
 <h3 className="mb-3 text-xs font-semibold tracking-wider text-neutral-500">{title}</h3>
 {children}
 </section>
 );
}

async function renderWidget(w: SidebarWidget): Promise<ReactNode | null> {
 switch (w.kind) {
 case "hot":
 return renderHot(w);
 case "categories":
 return renderCategories(w);
 case "tags":
 return renderTags(w);
 case "creators":
 return renderCreators(w);
 case "stats":
 return renderStats(w);
 case "about":
 return renderAbout(w);
 case "comments":
 return renderComments(w);
 case "random":
 return renderRandom(w);
 case "notice":
 return renderNotice(w);
 case "custom":
 return renderCustom(w);
 default:
 return null;
 }
}

// ---------- 内容排行 ----------

async function renderHot(w: SidebarWidget) {
 const cfg = w.config as { type: "ALL" | "IMAGE" | "GAME"; sort: "latest" | "popular" | "downloads"; count: number; display: "card" | "list" | "masonry" };
 const { items } = await getFeed({
 type: cfg.type === "ALL" ? undefined : cfg.type,
 sort: cfg.sort,
 pageSize: cfg.count,
 });
 if (items.length === 0) return null;

 const compact = cfg.display !== "list";
 return (
 <WidgetShell title={widgetTitle(w)}>
 <div className={compact ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
 {items.map((item) =>
 compact ? <MiniCard key={item.id} item={item} /> : <MiniRow key={item.id} item={item} />
 )}
 </div>
 </WidgetShell>
 );
}

function MiniThumb({ item, className = "" }: { item: FeedItem; className?: string }) {
 return (
 <span className={`relative block overflow-hidden bg-neutral-100 ${className}`}>
 {item.cover ? (
 /* eslint-disable-next-line @next/next/no-img-element */
 <img
 src={item.cover.url}
 alt={item.title}
 loading="lazy"
 decoding="async"
 className="h-full w-full object-cover"
 />
 ) : (
 <span className="absolute inset-0 grid place-items-center bg-brand-50 text-sm font-semibold text-brand-300">
 {(item.title ?? "?").slice(0, 1).toUpperCase()}
 </span>
 )}
 </span>
 );
}

function MiniRow({ item }: { item: FeedItem }) {
 return (
 <Link href={`/resources/${item.slug}`} className="group flex items-center gap-2.5 rounded-none p-1 transition hover:bg-brand-50">
 <MiniThumb item={item} className="h-11 w-16 shrink-0 rounded-none" />
 <span className="min-w-0">
 <span className="block truncate text-xs font-medium text-neutral-800 group-hover:text-neutral-950">{item.title}</span>
 <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-400">
 <span className="truncate">{item.author.name ?? item.author.username}</span>
 {item.type === "GAME" && <span className="rounded-none bg-emerald-50 px-1 text-[9px] font-medium text-emerald-600">游戏</span>}
 {item.type === "ARTICLE" && <span className="rounded-none bg-sky-50 px-1 text-[9px] font-medium text-sky-600">文章</span>}
 </span>
 </span>
 </Link>
 );
}

function MiniCard({ item }: { item: FeedItem }) {
 return (
 <Link href={`/resources/${item.slug}`} className="group block overflow-hidden rounded-none border border-brand-200/70 transition hover:border-brand-500">
 <MiniThumb item={item} className="aspect-[4/3] w-full" />
 <span className="block px-1.5 py-1">
 <span className="block truncate text-[11px] font-medium text-neutral-800">{item.title}</span>
 <span className="block truncate text-[10px] text-neutral-400">{item.author.name ?? item.author.username}</span>
 </span>
 </Link>
 );
}

// ---------- 分类入口 ----------

async function renderCategories(w: SidebarWidget) {
 const cfg = w.config as { slugs: string[] };
 const categories = await getCategories();
 let list = categories;
 if (cfg.slugs.length > 0) {
 const set = new Set(cfg.slugs);
 const sel = list.filter((c) => set.has(c.slug));
 if (sel.length > 0) list = sel;
 }
 if (list.length === 0) return null;

 return (
 <WidgetShell title={widgetTitle(w)}>
 <ul className="space-y-0.5">
 {list.map((c) => (
 <li key={c.id}>
 <Link
 href={`/browse?cat=${c.slug}`}
 className="group flex items-center gap-2 rounded-none px-2 py-1.5 text-sm text-neutral-600 transition hover:bg-brand-50 hover:text-neutral-900"
 >
 <span className="grid h-6 w-6 shrink-0 place-items-center rounded-none border border-brand-600 bg-brand-500 text-[11px] font-semibold text-white">
 {(c.name ?? "?").slice(0, 1)}
 </span>
 <span className="min-w-0 flex-1 truncate">{c.name}</span>
 <ArrowUpRight size={12} className="text-neutral-300 transition group-hover:text-neutral-500" aria-hidden />
 </Link>
 </li>
 ))}
 </ul>
 </WidgetShell>
 );
}

// ---------- 标签 ----------

async function renderTags(w: SidebarWidget) {
 const cfg = w.config as { count: number; slugs: string[] };
 let tags: { slug: string; name: string; count: number }[];
 if (cfg.slugs.length > 0) {
 const rows = await prisma.tag.findMany({
 where: { slug: { in: cfg.slugs } },
 select: { slug: true, name: true, count: true },
 });
 const order = new Map(rows.map((t) => [t.slug, t]));
 tags = cfg.slugs.flatMap((s) => (order.get(s) ? [order.get(s)!] : []));
 if (tags.length === 0) return null;
 } else {
 tags = await getTopTags(cfg.count);
 if (tags.length === 0) return null;
 }

 return (
 <WidgetShell title={widgetTitle(w)}>
 <div className="flex flex-wrap gap-1.5">
 {tags.map((t) => (
 <Link
 key={t.slug}
 href={`/tags/${t.slug}`}
 className="rounded-none border border-brand-200 px-2.5 py-1 text-xs text-neutral-600 transition hover:border-brand-500 hover:text-brand-700"
 >
 #{t.name}
 </Link>
 ))}
 </div>
 </WidgetShell>
 );
}

// ---------- 人气创作者 ----------

async function renderCreators(w: SidebarWidget) {
 const cfg = w.config as { count: number };
 const creators = await getTopCreators(cfg.count);
 if (creators.length === 0) return null;
 return (
 <WidgetShell title={widgetTitle(w)}>
 <ul className="space-y-0.5">
 {creators.map((c) => (
 <li key={c.username}>
 <Link href={`/u/${c.username}`} className="group flex items-center gap-2.5 rounded-none px-2 py-1.5 transition hover:bg-brand-50">
 <Avatar name={c.name} username={c.username} avatarKey={c.avatarKey} size="sm" />
 <span className="min-w-0 flex-1">
 <span className="block truncate text-sm font-medium text-neutral-800 group-hover:text-neutral-950">{c.name ?? c.username}</span>
 <span className="block truncate text-[11px] text-neutral-400">
 {c.resources} 作品 · {formatCount(c.followers)} 粉丝
 </span>
 </span>
 </Link>
 </li>
 ))}
 </ul>
 </WidgetShell>
 );
}

// ---------- 站点数据 ----------

async function renderStats(w: SidebarWidget) {
 const stats = await getHomeStats();
 const items = [
 { label: "上架内容", v: stats.resources },
 { label: "注册用户", v: stats.users },
 { label: "累计下载", v: stats.downloads },
 { label: "累计浏览", v: stats.views },
 ];
 return (
 <WidgetShell title={widgetTitle(w)}>
 <div className="grid grid-cols-2 gap-2">
 {items.map((it) => (
 <div key={it.label} className="rounded-none border border-brand-200 bg-brand-50/40 px-2.5 py-2 text-center">
 <div className="text-base font-semibold tabular-nums text-brand-700">{formatCount(it.v)}</div>
 <div className="text-[11px] text-neutral-400">{it.label}</div>
 </div>
 ))}
 </div>
 </WidgetShell>
 );
}

// ---------- 站点说明 ----------

async function renderAbout(w: SidebarWidget) {
 const cfg = w.config as { text: string };
 const text = cfg.text?.trim();
 if (!text) return null;
 return (
 <WidgetShell title={widgetTitle(w)}>
 <p className="whitespace-pre-wrap text-xs leading-5 text-neutral-600">{text}</p>
 </WidgetShell>
 );
}

// ---------- 最新评论 ----------

async function renderComments(w: SidebarWidget) {
 const cfg = w.config as { count: number };
 const rows = await prisma.comment.findMany({
 where: { status: "PUBLIC", resource: { status: "PUBLISHED" } },
 orderBy: { createdAt: "desc" },
 take: cfg.count,
 select: {
 id: true,
 content: true,
 createdAt: true,
 author: { select: { username: true, name: true, avatarKey: true } },
 resource: { select: { slug: true, title: true } },
 },
 });
 if (rows.length === 0) return null;

 return (
 <WidgetShell title={widgetTitle(w)}>
 <ul className="space-y-2.5">
 {rows.map((c) => (
 <li key={c.id} className="flex gap-2">
 <Avatar name={c.author.name} username={c.author.username} avatarKey={c.author.avatarKey} size="xs" />
 <span className="min-w-0 flex-1">
 <span className="flex items-baseline gap-1.5">
 <span className="truncate text-xs font-medium text-neutral-800">{c.author.name ?? c.author.username}</span>
 <span className="shrink-0 text-[10px] text-neutral-300">{timeAgo(c.createdAt)}</span>
 </span>
 <Link
 href={`/resources/${c.resource.slug}`}
 className="mt-0.5 block truncate text-xs leading-5 text-neutral-500 hover:text-neutral-800"
 title={c.content}
 >
 {c.content}
 </Link>
 <span className="mt-0.5 block truncate text-[10px] text-neutral-400">于「{c.resource.title}」</span>
 </span>
 </li>
 ))}
 </ul>
 </WidgetShell>
 );
}

// ---------- 随机推荐（手气不错） ----------

async function renderRandom(w: SidebarWidget) {
 const cfg = w.config as { count: number };
 // 轻量 id 池洗牌后按 id 精取（SQLite 无原生 random 排序；资源量大时池子封顶 500）
 const pool = await prisma.resource.findMany({
 where: { status: "PUBLISHED" },
 select: { id: true },
 take: 500,
 orderBy: { createdAt: "desc" },
 });
 if (pool.length === 0) return null;
 const ids = [...pool].sort(() => Math.random() - 0.5).slice(0, cfg.count).map((r) => r.id);
 const { items } = await getFeed({ ids, pageSize: cfg.count });
 if (items.length === 0) return null;

 return (
 <WidgetShell title={widgetTitle(w)}>
 <div className="grid gap-2">
 {items.map((item) => (
 <MiniRow key={item.id} item={item} />
 ))}
 </div>
 <p className="mt-2 text-center text-[10px] text-neutral-400">每次刷新随机换一批</p>
 </WidgetShell>
 );
}

// ---------- 公告栏 ----------

const NOTICE_STYLES: Record<string, { box: string; icon: ReactNode }> = {
 info: {
 box: "border-sky-200 bg-sky-50/70 text-sky-900",
 icon: <Bell size={13} aria-hidden />,
 },
 warn: {
 box: "border-amber-200 bg-amber-50/70 text-amber-900",
 icon: <Megaphone size={13} aria-hidden />,
 },
 event: {
 box: "border-rose-200 bg-rose-50/70 text-rose-900",
 icon: <Calendar size={13} aria-hidden />,
 },
};

function renderNotice(w: SidebarWidget) {
 const cfg = w.config as { items: { level: "info" | "warn" | "event"; text: string }[] };
 const items = (cfg.items ?? []).filter((n) => n.text?.trim());
 if (items.length === 0) return null;

 return (
 <WidgetShell title={widgetTitle(w)}>
 <ul className="space-y-1.5">
 {items.map((n, i) => {
 const s = NOTICE_STYLES[n.level] ?? NOTICE_STYLES.info;
 return (
 <li key={i} className={`flex items-start gap-2 rounded-none border px-2.5 py-2 text-xs leading-5 ${s.box}`}>
 <span className="mt-0.5 shrink-0 opacity-70">{s.icon}</span>
 <span className="min-w-0 whitespace-pre-wrap">{n.text}</span>
 </li>
 );
 })}
 </ul>
 </WidgetShell>
 );
}

// ---------- 自定义内容（Markdown + 链接列表） ----------

async function renderCustom(w: SidebarWidget) {
 const cfg = w.config as { content: string; links: { label: string; href: string }[] };
 const content = (cfg.content ?? "").trim();
 const links = Array.isArray(cfg.links) ? cfg.links : [];
 if (!content && links.length === 0) return null;
 return (
 <WidgetShell title={widgetTitle(w)}>
 {content && (
 <div className="md-body">
 <Markdown>{content}</Markdown>
 </div>
 )}
 {links.length > 0 && (
 <ul className="mt-1.5 space-y-0.5">
 {links.map((l, i) => {
 const ext = /^https?:\/\//i.test(l.href);
 return (
 <li key={`${l.href}-${i}`}>
 <Link
 href={l.href}
 target={ext ? "_blank" : undefined}
 rel={ext ? "noopener noreferrer" : undefined}
 className="group flex items-center gap-2 rounded-none px-2 py-1.5 text-sm text-neutral-700 transition hover:bg-brand-50 hover:text-neutral-900"
 >
 <span className="min-w-0 flex-1 truncate">{l.label}</span>
 {ext && <ArrowUpRight size={12} className="shrink-0 text-neutral-300 transition group-hover:text-neutral-500" aria-hidden />}
 </Link>
 </li>
 );
 })}
 </ul>
 )}
 </WidgetShell>
 );
}
