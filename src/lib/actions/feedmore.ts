"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { getFeed, toFeedCard, type FeedCard } from "@/lib/queries";

export type ListPageParams = {
  page: number;
  pageSize: number;
  type: "ALL" | "IMAGE" | "GAME" | "ARTICLE";
  sort: "latest" | "popular" | "downloads";
  categorySlugs: string[];
  tagSlugs: string[];
  /** 热度时间窗口（排序=最热/最多下载时生效）；缺省不限制 */
  period?: "week" | "month";
};

// 公共 action：入参全部过 zod（防伪造调用塞超长数组/任意字符串打 DB）
const listPageSchema = z.object({
  page: z.number().int().min(2).max(1000),
  pageSize: z.number().int().min(1).max(48),
  type: z.enum(["ALL", "IMAGE", "GAME", "ARTICLE"]),
  sort: z.enum(["latest", "popular", "downloads"]),
  categorySlugs: z.array(z.string().max(80)).max(30),
  tagSlugs: z.array(z.string().max(80)).max(30),
  period: z.enum(["week", "month"]).optional(),
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
    period: parsed.data.period,
    page,
    pageSize,
  });
  return { ok: true, items: r.items.map(toFeedCard), hasMore: r.hasMore };
}

// ---------- /browse 无限滚动 ----------

/** 浏览页 FeedBrowser 的完整筛选集（与首屏 getFeed 同一套入参），供无限滚动追加后续页 */
export type BrowseFeedParams = {
  type: "ALL" | "IMAGE" | "GAME" | "ARTICLE";
  sort: "latest" | "popular" | "downloads";
  period: "all" | "day" | "week" | "month";
  categorySlug?: string;
  tagSlug?: string;
  q?: string;
  /** 仅关注 Tab：由服务端从登录会话推导关注对象，客户端不传 userId */
  follow?: boolean;
  page: number;
  pageSize: number;
};

const browseFeedSchema = z.object({
  type: z.enum(["ALL", "IMAGE", "GAME", "ARTICLE"]),
  sort: z.enum(["latest", "popular", "downloads"]),
  period: z.enum(["all", "day", "week", "month"]),
  categorySlug: z.string().max(80).optional(),
  tagSlug: z.string().max(80).optional(),
  q: z.string().max(60).optional(),
  follow: z.boolean().optional(),
  page: z.number().int().min(2).max(2000),
  pageSize: z.number().int().min(1).max(48),
});

/** 浏览页「加载后续页」：按与首屏一致的筛选取第 page 页（page ≥ 2），追加进同一条流 */
export async function loadBrowseFeedAction(
  p: BrowseFeedParams,
): Promise<{ ok: boolean; items: FeedCard[]; hasMore: boolean; error?: string }> {
  const parsed = browseFeedSchema.safeParse(p);
  if (!parsed.success) return { ok: false, items: [], hasMore: false, error: "参数不合法" };

  // 「关注」列表以服务端会话为准：未登录时视为普通浏览
  let followOnlyOf: string | undefined;
  if (parsed.data.follow) {
    const session = await auth();
    followOnlyOf = session?.user?.id ?? undefined;
  }

  const r = await getFeed({
    type: parsed.data.type,
    sort: parsed.data.sort,
    period: parsed.data.period,
    categorySlug: parsed.data.categorySlug,
    tagSlug: parsed.data.tagSlug,
    q: parsed.data.q,
    followOnlyOf,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
  return { ok: true, items: r.items.map(toFeedCard), hasMore: r.hasMore };
}
