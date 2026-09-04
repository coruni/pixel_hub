import Link from "next/link";
import type { ReactNode } from "react";
import { getCategories, getFeed, getTopTags } from "@/lib/queries";
import { enumParam, intParam, str, type SP } from "@/lib/search-params";
import MasonryGrid from "@/components/resource/MasonryGrid";

type Props = {
 base: string; // 当前页路径
 searchParams: SP;
 authed?: boolean;
 userId?: string;
 heading?: ReactNode;
 showTags?: boolean;
};

export default async function FeedBrowser({ base, searchParams, authed, userId, heading, showTags }: Props) {
 const sp = searchParams;
 const type = enumParam(sp, "type", ["ALL", "GAME", "IMAGE", "ARTICLE"] as const, "ALL");
 const cat = str(sp, "cat");
 const tag = str(sp, "tag");
 const sort = enumParam(sp, "sort", ["latest", "popular", "downloads"] as const, "latest");
 const period = enumParam(sp, "period", ["all", "day", "week", "month"] as const, "all");
 const q = str(sp, "q")?.trim();
 const follow = str(sp, "follow") === "1" && !!authed && !!userId;
 const page = intParam(sp, "page", 1);

 const categories = await getCategories();
 const { items, hasMore } = await getFeed({
 type,
 categorySlug: follow ? undefined : cat,
 tagSlug: follow ? undefined : tag,
 sort,
 period,
 q: follow ? undefined : q,
 followOnlyOf: follow ? userId : undefined,
 page,
 pageSize: 30,
 });

 // 构造过滤链接
 function href(patch: Record<string, string | null>): string {
 const usp = new URLSearchParams();
 // 保留当前筛选，patch 里 null 表示清除，type/follow 变化时清掉从属筛选
 if (patch.type || patch.follow || (patch.type === null && patch.follow === null)) {
 // 切换大类：清分类/标签/关注
 } else {
 if (cat) usp.set("cat", cat);
 if (tag) usp.set("tag", tag);
 if (follow) usp.set("follow", "1");
 }
 if (type !== "ALL" && !patch.type && patch.follow) {
 // 进入关注 Tab 时清类型/分类
 }
 const nextType = patch.type === undefined ? type : patch.type;
 if (nextType && nextType !== "ALL") usp.set("type", nextType);
 const keep = { sort, period, q } as Record<string, string | undefined>;
 for (const [k, v] of Object.entries(keep)) if (v) usp.set(k, v);
 for (const [k, v] of Object.entries(patch)) {
 if (v === null) usp.delete(k);
 else if (k !== "type" && k !== "follow") usp.set(k, v);
 else if (k === "follow") {
 if (v === "1") usp.set("follow", "1");
 else usp.delete("follow");
 }
 }
 if (patch.page) usp.set("page", patch.page);
 else if (!("follow" in patch)) usp.set("page", String(page));
 const qs = usp.toString();
 return qs ? `${base}?${qs}` : base;
 }

 // 分类全类型通用，不随内容类型 tab 过滤
 const showCats = categories;
 const topTags = showTags ? await getTopTags() : [];

 const chip = (active: boolean) =>
 `whitespace-nowrap rounded-none border px-3 py-1 text-xs transition ${
 active
 ? "border-brand-600 bg-brand-500 text-white"
 : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-500"
 }`;

 return (
 <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
 {heading}

 {/* 主 Tab：类型 + 关注 */}
 <div className="flex flex-wrap items-center gap-2">
 {[
 { key: "ALL", label: "全部" },
 { key: "IMAGE", label: "图片" },
 { key: "GAME", label: "游戏" },
 { key: "ARTICLE", label: "文章" },
 ].map((t) => (
 <Link
 key={t.key}
 scroll={false} href={href({ type: t.key, page: "1", follow: null })}
 className={chip(!follow && type === t.key)}
 >
 {t.label}
 </Link>
 ))}
 {authed && userId && (
 <Link scroll={false} href={href({ follow: "1", page: "1" })} className={chip(follow)}>
 关注
 </Link>
 )}
 <span className="mx-2 h-4 w-px bg-neutral-300" />
 <span className="flex items-center gap-1.5 text-xs">
 <Link scroll={false} href={href({ sort: "latest" })} className={sort === "latest" ? "font-semibold text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}>
 最新
 </Link>
 <Link scroll={false} href={href({ sort: "popular" })} className={sort === "popular" ? "font-semibold text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}>
 最热
 </Link>
 <Link scroll={false} href={href({ sort: "downloads" })} className={sort === "downloads" ? "font-semibold text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}>
 最多下载
 </Link>
 </span>
 <span className="mx-1 text-neutral-300">|</span>
 <span className="flex items-center gap-1.5 text-xs">
 {(["all", "day", "week", "month"] as const).map((p) => (
 <Link key={p} scroll={false} href={href({ period: p })} className={period === p ? "font-semibold text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}>
 {p === "all" ? "全部时间" : p === "day" ? "今天" : p === "week" ? "本周" : "本月"}
 </Link>
 ))}
 </span>
 </div>

 {/* 分类：默认收起（只显示前 8 个），超出的收进「更多」原生展开，选中项始终可见 */}
 {!follow && showCats.length > 0 && (() => {
 const CATS_VISIBLE = 8;
 // 选中的分类若落在折叠区，把它换到可见区末位展示
 const activeIdx = showCats.findIndex((c) => cat === c.slug);
 const visible = showCats.slice(0, CATS_VISIBLE);
 const rest = showCats.slice(CATS_VISIBLE);
 if (activeIdx >= CATS_VISIBLE) {
 const active = showCats[activeIdx];
 visible[visible.length - 1] = active;
 rest[activeIdx - CATS_VISIBLE] = showCats[CATS_VISIBLE - 1];
 }
 return (
 <div className="mt-3 flex flex-wrap items-center gap-1.5">
 <span className="text-xs text-neutral-400">分类</span>
 <Link scroll={false} href={href({ cat: null })} className={chip(!cat)}>
 全部分类
 </Link>
 {visible.map((c) => (
 <Link key={c.id} scroll={false} href={href({ cat: c.slug })} className={chip(cat === c.slug)}>
 {c.name}
 </Link>
 ))}
 {rest.length > 0 && (
 <details className="group flex w-full flex-wrap items-center gap-1.5">
 <summary
 className={`${chip(false)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
 >
 {/* 展开后按钮文案切换为「收起」 */}
 <span className="group-open:hidden">+{rest.length} 个分类</span>
 <span className="hidden group-open:inline">收起分类</span>
 </summary>
 <div className="w-full">
 {rest.map((c) => (
 <Link
 key={c.id}
 scroll={false} href={href({ cat: c.slug })}
 className={`${chip(cat === c.slug)} mr-1.5 inline-block`}
 >
 {c.name}
 </Link>
 ))}
 </div>
 </details>
 )}
 </div>
 );
 })()}

 {/* 热门标签（浏览页） */}
 {!follow && showTags && topTags.length > 0 && (
 <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
 <span className="text-neutral-400">热门标签：</span>
 {topTags.slice(0, 14).map((t) => (
 <Link key={t.slug} href={`/tags/${t.slug}`} className="text-neutral-500 hover:text-neutral-900">
 #{t.name}
 </Link>
 ))}
 </div>
 )}

 {/* 瀑布流（归档大屏最多五列） */}
 <MasonryGrid className="mt-4" items={items} maxCols={5} gap={12} />

 {items.length === 0 && (
 <div className="mt-20 text-center text-sm text-neutral-400">
 {follow ? "关注的作者还没有新内容" : q ? `没有找到与「${q}」相关的内容` : "这里还没有内容"}
 </div>
 )}

 {/* 分页 */}
 <div className="mt-6 flex items-center justify-center gap-3 text-sm">
 {page > 1 && (
 <Link href={href({ page: String(page - 1) })} className="rounded-none border border-brand-200 px-3 py-1.5 hover:bg-neutral-100">
 上一页
 </Link>
 )}
 <span className="text-xs text-neutral-400">第 {page} 页</span>
 {hasMore && (
 <Link href={href({ page: String(page + 1) })} className="rounded-none border border-brand-200 px-3 py-1.5 hover:bg-neutral-100">
 下一页
 </Link>
 )}
 </div>
 </div>
 );
}
