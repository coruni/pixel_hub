"use client";

import { ChevronDown } from "lucide-react";
import type { CardRatio, ContentDisplay, ContentType } from "@/lib/display";
import { loadListPageAction } from "@/lib/actions/feedmore";
import { useLoadMore } from "@/lib/hooks";
import ResourceGrid from "@/components/resource/ResourceGrid";

type Sort = "latest" | "popular" | "downloads";
type Item = Awaited<ReturnType<typeof loadListPageAction>>["items"][number];

/** 首页 list 板块的「下一页 / 加载更多」：按板块相同筛选取后续页并追加渲染 */
export default function ListMore({
	type,
	sort,
	categorySlugs,
	tagSlugs,
	pageSize,
	display,
	ratio,
}: {
	type: "ALL" | ContentType;
	sort: Sort;
	categorySlugs: string[];
	tagSlugs: string[];
	pageSize: number;
	display: ContentDisplay;
	ratio?: CardRatio | null;
}) {
	const { more, hasMore, done, err, pending, loadNext } = useLoadMore<Item>((page) =>
		loadListPageAction({ page, pageSize, type, sort, categorySlugs, tagSlugs })
	);

	if (done) {
		return (
			<div className="mt-5 flex items-center justify-center">
				<span className="text-xs text-neutral-400">已全部加载</span>
			</div>
		);
	}

	return (
		<div>
			{more.length > 0 && (
				<div className="mt-4">
					<ResourceGrid items={more} display={display} ratio={ratio} />
				</div>
			)}
			{err && <p className="mt-2 text-center text-xs text-red-500">{err}</p>}
			{hasMore && (
				<div className="mt-5 flex justify-center">
					<button
						type="button"
						disabled={pending}
						onClick={loadNext}
						className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-5 py-2 text-sm text-neutral-700 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
					>
						{pending ? "加载中…" : more.length > 0 ? "下一页" : "加载更多"}
						<ChevronDown size={14} aria-hidden />
					</button>
				</div>
			)}
		</div>
	);
}
