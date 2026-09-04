"use server";

import { z } from "zod";
import { getFeed, toFeedCard, type FeedCard } from "@/lib/queries";

export type ListPageParams = {
  page: number;
  pageSize: number;
  type: "ALL" | "IMAGE" | "GAME" | "ARTICLE";
  sort: "latest" | "popular" | "downloads";
  categorySlugs: string[];
  tagSlugs: string[];
};

// 公共 action：入参全部过 zod（防伪造调用塞超长数组/任意字符串打 DB）
const listPageSchema = z.object({
  page: z.number().int().min(2).max(1000),
  pageSize: z.number().int().min(1).max(48),
  type: z.enum(["ALL", "IMAGE", "GAME", "ARTICLE"]),
  sort: z.enum(["latest", "popular", "downloads"]),
  categorySlugs: z.array(z.string().max(80)).max(30),
  tagSlugs: z.array(z.string().max(80)).max(30),
});

/** 首页「内容板块」翻页：按与首屏一致的筛选取第 page 页（page ≥ 2），返回可序列化卡片 */
export async function loadListPageAction(
  p: ListPageParams,
): Promise<{ ok: boolean; items: FeedCard[]; hasMore: boolean; error?: string }> {
  const parsed = listPageSchema.safeParse(p);
  if (!parsed.success) return { ok: false, items: [], hasMore: false, error: "参数不合法" };
  const page = parsed.data.page;
  const pageSize = parsed.data.pageSize;
  const r = await getFeed({
    type: parsed.data.type,
    sort: parsed.data.sort,
    categorySlugs: parsed.data.categorySlugs,
    tagSlugs: parsed.data.tagSlugs,
    page,
    pageSize,
  });
  return { ok: true, items: r.items.map(toFeedCard), hasMore: r.hasMore };
}
