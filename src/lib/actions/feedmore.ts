"use server";

import { getFeed, toFeedCard, type FeedCard } from "@/lib/queries";

export type ListPageParams = {
  page: number;
  pageSize: number;
  type: "ALL" | "IMAGE" | "GAME" | "ARTICLE";
  sort: "latest" | "popular" | "downloads";
  categorySlugs: string[];
  tagSlugs: string[];
};

/** 首页「内容板块」翻页：按与首屏一致的筛选取第 page 页（page ≥ 2），返回可序列化卡片 */
export async function loadListPageAction(
  p: ListPageParams
): Promise<{ ok: boolean; items: FeedCard[]; hasMore: boolean; error?: string }> {
  const page = Math.max(2, Math.floor(p.page) || 2);
  const pageSize = Math.max(1, Math.min(48, Math.floor(p.pageSize) || 12));
  const r = await getFeed({
    type: p.type,
    sort: p.sort,
    categorySlugs: p.categorySlugs,
    tagSlugs: p.tagSlugs,
    page,
    pageSize,
  });
  return { ok: true, items: r.items.map(toFeedCard), hasMore: r.hasMore };
}
