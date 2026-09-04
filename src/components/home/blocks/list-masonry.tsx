"use client";

import { useState, useTransition } from "react";
import BlockShell from "@/components/home/BlockShell";
import { ChevronDown } from "lucide-react";
import type { ContentType } from "@/lib/display";
import { loadListPageAction } from "@/lib/actions/feedmore";
import type { FeedCard } from "@/lib/queries";
import MasonryGrid from "@/components/resource/MasonryGrid";

type Sort = "latest" | "popular" | "downloads";

/**
 * 首页「内容板块 · 瀑布流」一体化客户端：首屏 initial 由 SSR 注入，点击「下一页」按板块相同
 * 筛选取后续页并 append 进同一条流 —— MasonryGrid 会自动把新卡补进当前最短列。
 */
export default function ListMasonry({
 title,
 initial,
 type,
 sort,
 categorySlugs,
 tagSlugs,
 pageSize,
}: {
 title: string | null;
 initial: FeedCard[];
 type: "ALL" | ContentType;
 sort: Sort;
 categorySlugs: string[];
 tagSlugs: string[];
 pageSize: number;
}) {
 const [items, setItems] = useState(initial);
 const [page, setPage] = useState(1);
 const [hasMore, setHasMore] = useState(true);
 const [done, setDone] = useState(false);
 const [err, setErr] = useState<string | null>(null);
 const [pending, start] = useTransition();

 function loadNext() {
 start(async () => {
 const r = await loadListPageAction({ page: page + 1, pageSize, type, sort, categorySlugs, tagSlugs });
 if (!r.ok) {
 setErr(r.error ?? "加载失败");
 return;
 }
 setItems((prev) => [...prev, ...r.items]);
 setPage((p) => p + 1);
 setHasMore(r.hasMore);
 if (!r.hasMore || r.items.length === 0) setDone(true);
 });
 }

 return (
<BlockShell title={title}>
 <MasonryGrid items={items} />
 {err && <p className="mt-2 text-center text-xs text-red-500">{err}</p>}
 {done ? (
 <div className="mt-5 flex items-center justify-center">
 <span className="text-xs text-neutral-400">已全部加载</span>
 </div>
 ) : (
 hasMore && (
 <div className="mt-5 flex justify-center">
 <button
 type="button"
 disabled={pending}
 onClick={loadNext}
 className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-5 py-2 text-sm text-neutral-700 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
 >
 {pending ? "加载中…" : items.length > 0 ? "下一页" : "加载更多"}
 <ChevronDown size={14} aria-hidden />
 </button>
 </div>
 )
 )}
 </BlockShell>
 );
}
