import { publicUrl } from "@/lib/storage";
import { prisma } from "@/lib/db/prisma";
import { isOnline } from "@/lib/online";
import { auth } from "@/lib/auth";
import { searchRuntime } from "@/lib/search";
import { fetchRootCommentsPage } from "@/lib/comments-paging";
import type { FeedCursor } from "@/lib/feed-paging";
import { cache } from "react";
import { unstable_noStore as noStore } from "next/cache";
import { cachedInRequest, cachedInRequestWithArgs } from "@/lib/cached-in-request";
import type { Prisma, ResourceType } from "@prisma/client";

export type FeedItem = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  type: "GAME" | "IMAGE" | "ARTICLE" | "MUSIC" | "VIDEO";
  publishedAt: Date | null;
  createdAt: Date;
  likeCount: number;
  viewCount: number;
  favoriteCount: number;
  commentCount: number;
  downloadCount: number;
  loginRequired: boolean;
  nsfw: boolean;
  category: { slug: string; name: string } | null;
  tags: { slug: string; name: string }[];
  author: { username: string; name: string | null; nameColor: string | null };
  cover: {
    url: string;
    width: number | null;
    height: number | null;
    placeholder: string | null;
  } | null;
};

// 资源卡组件实际渲染所需的最小字段（无 Date，可安全跨 server action 序列化）。
export type FeedCard = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  type: "GAME" | "IMAGE" | "ARTICLE" | "MUSIC" | "VIDEO";
  likeCount: number;
  viewCount: number;
  favoriteCount: number;
  commentCount: number;
  downloadCount: number;
  loginRequired: boolean;
  nsfw: boolean;
  category: { slug: string; name: string } | null;
  author: { username: string; name: string | null; nameColor: string | null };
  cover: {
    url: string;
    width: number | null;
    height: number | null;
    placeholder: string | null;
  } | null;
};

export function toFeedCard(i: FeedItem): FeedCard {
  return {
    id: i.id,
    slug: i.slug,
    title: i.title,
    summary: i.summary,
    type: i.type,
    likeCount: i.likeCount,
    viewCount: i.viewCount,
    favoriteCount: i.favoriteCount,
    commentCount: i.commentCount,
    downloadCount: i.downloadCount,
    loginRequired: i.loginRequired,
    nsfw: i.nsfw,
    category: i.category,
    author: i.author,
    cover: i.cover,
  };
}

export type SortKey = "latest" | "popular" | "downloads";
export type FeedParams = {
  type?: ResourceType | "ALL";
  categorySlug?: string;
  tagSlug?: string;
  categorySlugs?: string[]; // 多选（首页 list 板块）；为空回退单值 categorySlug
  tagSlugs?: string[]; // 多选（任一命中）
  sort?: SortKey;
  period?: "all" | "day" | "week" | "month";
  q?: string;
  authorUsername?: string;
  followOnlyOf?: string; // 用户 id：只看关注
  includeStatuses?: ("PUBLISHED" | "PENDING" | "REJECTED" | "DRAFT")[];
  ids?: string[]; // 指定 id 集合（首页主推等），顺序需调用方自行按 id 重排
  page?: number;
  pageSize?: number;
  /**
   * keyset 游标：给了它就**忽略 page/skip**，只取「排序上排在游标之后」的一窗。
   * 由 getFeed 返回的 nextCursor 原样回传即可（FeedInfinite 走这条路径）。
   * 调用方若来自客户端，必须先过 parseFeedCursor 校验。
   */
  cursor?: FeedCursor;
  /**
   * 是否连带取 `tags` 关联。默认 false —— 卡片不渲染标签，只有服务端打分逻辑
   * （getRelated / getRecommendations）需要它。多带这个关联会让每条资源多 join 一次
   * 多对多表，实测占首页查询耗时的三成以上，见 feedTagsSelect 的注释。
   */
  withTags?: boolean;
  /** D9：显式覆盖 NSFW 可见性；缺省按当前登录态（登录可见全站，游客只见 SFW） */
  includeNsfw?: boolean;
};

const coverSelect = {
  thumbKey: true,
  bigKey: true,
  storageKey: true,
  placeholder: true,
  width: true,
  height: true,
} as const;

function coverUrl(m: {
  thumbKey: string | null;
  bigKey: string | null;
  storageKey: string;
}): string {
  if (m.thumbKey) return publicUrl(m.thumbKey);
  if (m.bigKey) return publicUrl(m.bigKey);
  return publicUrl(m.storageKey);
}

type FeedRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  type: ResourceType;
  publishedAt: Date | null;
  createdAt: Date;
  likeCount: number;
  viewCount: number;
  favoriteCount: number;
  commentCount: number;
  downloadCount: number;
  loginRequired: boolean;
  nsfw: boolean;
  category: { slug: string; name: string } | null;
  /**
   * 可选：只有 `withTags: true` 的调用才取这个关联（见 feedTagsSelect）。
   * 卡片路径不带 → toFeedItem 落到空数组。
   */
  tags?: { tag: { slug: string; name: string } }[];
  author: { username: string; name: string | null; nameColor: string | null };
  coverMedia: {
    thumbKey: string | null;
    bigKey: string | null;
    storageKey: string;
    placeholder: string | null;
    width: number | null;
    height: number | null;
  } | null;
};

// Feed 列表实际用到的字段（显式 select：不取 description/meta 等大字段）
const feedSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  type: true,
  publishedAt: true,
  createdAt: true,
  likeCount: true,
  viewCount: true,
  favoriteCount: true,
  commentCount: true,
  downloadCount: true,
  loginRequired: true,
  nsfw: true,
  coverMedia: { select: coverSelect },
  author: { select: { username: true, name: true, nameColor: true } },
  category: { select: { slug: true, name: true } },
} satisfies Prisma.ResourceSelect;

/**
 * `tags` 关联**不放进 feedSelect**，只在真正需要时按需拼上。
 *
 * 为什么：卡片（ResourceCard / ResourceRow）从头到尾不渲染标签，`FeedCard.tags` 唯一的
 * 消费方是服务端的打分逻辑（getRelated 的 relatedScore、getRecommendations 的
 * scoreCandidates / itemSim）。而多带一个 `tags` 关联意味着每条资源都要 join 一次多对多表，
 * 实测在首页页大小（32 条）上占整条查询耗时的 30%，在推荐候选池（250×2 条）上占 45% ——
 * 全是白烧的。默认不带，需要打分的调用点显式传 `withTags: true`。
 */
const feedTagsSelect = {
  tags: { select: { tag: { select: { slug: true, name: true } } } },
} satisfies Prisma.ResourceSelect;

function toFeedItem(r: FeedRow): FeedItem {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    type: r.type,
    publishedAt: r.publishedAt,
    createdAt: r.createdAt,
    likeCount: r.likeCount,
    viewCount: r.viewCount,
    favoriteCount: r.favoriteCount,
    commentCount: r.commentCount,
    downloadCount: r.downloadCount,
    loginRequired: r.loginRequired,
    nsfw: r.nsfw,
    category: r.category ? { slug: r.category.slug, name: r.category.name } : null,
    // 未取 tags 时（绝大多数调用）这里是空数组；只有 withTags 路径会带上真实标签
    tags: r.tags?.map((t) => ({ slug: t.tag.slug, name: t.tag.name })) ?? [],
    author: {
      username: r.author.username,
      name: r.author.name,
      nameColor: r.author.nameColor,
    },
    cover: r.coverMedia
      ? {
          url: coverUrl(r.coverMedia),
          width: r.coverMedia.width,
          height: r.coverMedia.height,
          placeholder: r.coverMedia.placeholder,
        }
      : null,
  };
}

/**
 * D9 NSFW 隔离判定：当前请求是否已登录。getFeed / getRandomResourceIds / getCollectionDetail
 * 是全部「游客可见」的资源取数出口，登录态在此统一判定比调用点逐个传参更不易漏网
 * （首页板块、浏览/搜索/标签/作者主页、相关推荐、侧栏组件、无限追加 action 都汇到这里）。
 * 非请求上下文一律按游客处理（最安全）；显式 includeNsfw 参数可覆盖。
 */
const viewerAuthed = cache(async (): Promise<boolean> => {
  try {
    return !!(await auth())?.user;
  } catch {
    return false;
  }
});

export async function getFeed(
  params: FeedParams,
): Promise<{ items: FeedItem[]; page: number; hasMore: boolean; nextCursor: FeedCursor | null }> {
  const page = Math.max(1, params.page ?? 1);
  // D9：游客（含搜索引擎）只见 SFW；登录后全站可见
  const allowNsfw = params.includeNsfw ?? (await viewerAuthed());
  const pageSize = Math.max(1, Math.min(48, params.pageSize ?? 24));
  // tags 关联按需开启（默认不带）：只有打分路径需要，卡片路径白烧 join，见 feedTagsSelect
  const select = params.withTags ? { ...feedSelect, ...feedTagsSelect } : feedSelect;

  const where: Prisma.ResourceWhereInput = {
    status: params.includeStatuses ? { in: params.includeStatuses } : "PUBLISHED",
  };
  if (!allowNsfw) where.nsfw = false; // D9：未登录列表一律不含 NSFW
  if (params.type && params.type !== "ALL") where.type = params.type;
  if (params.categorySlugs && params.categorySlugs.length > 0) {
    where.category = { slug: { in: params.categorySlugs } };
  } else if (params.categorySlug) {
    where.category = { slug: params.categorySlug };
  }
  if (params.tagSlugs && params.tagSlugs.length > 0) {
    where.tags = { some: { tag: { slug: { in: params.tagSlugs } } } };
  } else if (params.tagSlug) {
    where.tags = { some: { tag: { slug: params.tagSlug } } };
  }
  // 作者过滤合并进嵌套关系（followOnlyOf 不再预查全量关注列表）
  const authorFilter: Prisma.UserWhereInput = {};
  if (params.authorUsername) authorFilter.username = params.authorUsername;
  if (params.followOnlyOf) authorFilter.followers = { some: { followerId: params.followOnlyOf } };
  if (Object.keys(authorFilter).length > 0) where.author = { is: authorFilter };
  // 指定 id 集合（首页主推等；q 检索时与候选求交集）
  if (params.ids && params.ids.length > 0) where.id = { in: params.ids };

  // —— 全文检索（可插拔引擎：PostgreSQL pg_trgm 默认 / Elasticsearch 可选，见 src/lib/search）——
  // 有 q 时进入全文路径：引擎产出「相关度降序的候选 id」，与本页其余业务过滤在主表求交集；
  // 结果按引擎相关度排序（与默认 latest 的差异：带词检索默认即相关性，UI 在 q 态提示「按相关度排序」）。
  // 引擎不可用（索引未建/ES 未配置）时回退原子串匹配，保证搜索永远可用。
  const q = params.q?.trim();
  let relevanceOrder: string[] | null = null;
  if (q) {
    const pinned = params.ids && params.ids.length > 0 ? new Set(params.ids) : null;
    try {
      const rt = await searchRuntime();
      const cand = await rt.engine.search(q, { limit: rt.candidateLimit });
      let ids = cand.ids;
      if (pinned) ids = ids.filter((id) => pinned.has(id));
      if (ids.length === 0) return { items: [], page, hasMore: false, nextCursor: null };
      relevanceOrder = ids;
      where.id = { in: ids };
    } catch (e) {
      console.error("[getFeed] 全文索引不可用，回退子串匹配", e);
      where.OR = [
        { title: { contains: q } },
        { summary: { contains: q } },
        { description: { contains: q } },
        { tags: { some: { tag: { name: { contains: q } } } } },
      ];
    }
  }
  if (params.period && params.period !== "all" && params.includeStatuses?.includes("PUBLISHED")) {
    const days = params.period === "day" ? 1 : params.period === "week" ? 7 : 30;
    where.publishedAt = { gte: new Date(Date.now() - days * 24 * 3600 * 1000) };
  } else if (params.period && params.period !== "all") {
    const days = params.period === "day" ? 1 : params.period === "week" ? 7 : 30;
    where.publishedAt = { gte: new Date(Date.now() - days * 24 * 3600 * 1000) };
  }

  // 全文相关度分页：候选 id 是结果顺序，先在业务过滤后的交集里取有序全集，再按页切片
  if (relevanceOrder) {
    const inter = await prisma.resource.findMany({
      where,
      select: { id: true },
    });
    const have = new Set(inter.map((r) => r.id));
    const ordered = relevanceOrder.filter((id) => have.has(id));
    const total = ordered.length;
    if (total === 0) return { items: [], page, hasMore: false, nextCursor: null };
    const pageIds = ordered.slice((page - 1) * pageSize, page * pageSize);
    if (pageIds.length === 0) return { items: [], page, hasMore: false, nextCursor: null };
    const fetched = await prisma.resource.findMany({
      where: { id: { in: pageIds } },
      select,
    });
    const byId = new Map(fetched.map((r) => [r.id, r]));
    const rows = pageIds
      .map((id) => byId.get(id))
      .filter((r): r is FeedRow => !!r);
    return {
      items: rows.map(toFeedItem),
      page,
      hasMore: page * pageSize < total,
      // 全文检索走的是「候选 id 全集 + 切片」，不接 keyset 游标（相关度顺序不是列值）
      nextCursor: null,
    };
  }

  // 排序带 id 决胜：同值时结果稳定（分页翻页不跳动）
  const orderBy: Prisma.ResourceOrderByWithRelationInput[] =
    params.sort === "popular"
      ? [{ likeCount: "desc" }, { publishedAt: "desc" }, { id: "desc" }]
      : params.sort === "downloads"
        ? [{ downloadCount: "desc" }, { publishedAt: "desc" }, { id: "desc" }]
        : [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }];

  // —— keyset（游标）分页 ——
  // 有 cursor 时不再用 skip：把「上一页最后一条」的位置展开成 keyset 条件，窗口永远从
  // 数据本身锚定，翻页期间有新内容插入也不会重复/漏（offset 分页做不到）。
  // 前提：资源流的排序键全在 Resource 主表上（author / tags 只是过滤，不参与排序）。
  if (params.cursor) {
    const after = cursorAfter(params.cursor, params.sort);
    where.AND = Array.isArray(where.AND) ? [...where.AND, after] : [after];
  }

  const rows = await prisma.resource.findMany({
    where,
    orderBy,
    take: pageSize + 1,
    // 游标模式不带 skip：窗口由 where 里的 keyset 条件决定
    ...(params.cursor ? {} : { skip: (page - 1) * pageSize }),
    select,
  });
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map(toFeedItem),
    page,
    hasMore,
    // 下一页的游标；没有下一页（或本页为空）时为 null
    nextCursor: hasMore && last ? toFeedCursor(last, params.sort) : null,
  };
}

/** 由一行的排序键值构造下一页游标 */
function toFeedCursor(row: FeedRow, sort: SortKey | undefined): FeedCursor {
  return {
    k:
      sort === "popular"
        ? row.likeCount
        : sort === "downloads"
          ? row.downloadCount
          : (row.publishedAt?.getTime() ?? 0),
    t: row.publishedAt ? row.publishedAt.getTime() : null,
    id: row.id,
  };
}

/**
 * keyset 条件：`ORDER BY 主排序键 DESC, publishedAt DESC, id DESC` 之后「严格排在游标之后」的行。
 *
 * 展开成字典序比较：(m1 < c1) OR (m1 = c1 AND m2 < c2) OR (m1 = c1 AND m2 = c2 AND m3 < c3)。
 * 三个键的降序组合已唯一确定一行（id 是主键），所以用 `lt` 而非 `lte` —— lte 会把游标那行
 * 自己再取回来，翻页就多一条。
 *
 * `createdAt` **不出现在 keyset 里**：它是 latest 排序在 publishedAt 之后的第三键，而 id 是主键，
 * (publishedAt, id) 已经唯一。像 id 一样把 createdAt 也带进去只会让 OR 分支翻倍、SQL 更贵，
 * 换不到任何正确性 —— 唯一代价是 publishedAt 与 id 都相同的情况本就不可能发生。
 *
 * publishedAt 可空，而 `lt` 对 NULL 恒为 UNKNOWN（Postgres 的 DESC 默认 NULLS FIRST），
 * 所以必须显式区分「游标还在时间区」「已进入 null 区」两种情形，否则 null 段的行会被整段跳过。
 */
function cursorAfter(c: FeedCursor, sort: SortKey | undefined): Prisma.ResourceWhereInput {
  const major: "likeCount" | "downloadCount" | "publishedAt" =
    sort === "popular" ? "likeCount" : sort === "downloads" ? "downloadCount" : "publishedAt";

  // latest 排序：主排序键就是 publishedAt，比较链只剩 (publishedAt, id)
  if (major === "publishedAt") {
    return {
      OR: [
        // 游标还在时间区 → 取更早的行
        ...(c.t !== null ? [{ publishedAt: { lt: new Date(c.t) } }] : []),
        // 游标本身 publishedAt 为空（已进 null 区）→ 只排空值本身
        ...(c.t === null ? [{ publishedAt: null }] : []),
        // 同值行按 id 决胜
        { publishedAt: c.t === null ? null : new Date(c.t), id: { lt: c.id } },
      ],
    };
  }

  // popular / downloads：主排序键是数值列，publishedAt 是第二键
  const atMajor = { [major]: c.k } as Prisma.ResourceWhereInput;
  return {
    OR: [
      // 主键更小 —— 后面所有行都算在内
      { [major]: { lt: c.k } } as Prisma.ResourceWhereInput,
      ...(c.t !== null
        ? [
            { ...atMajor, publishedAt: { lt: new Date(c.t) } },
            { ...atMajor, publishedAt: new Date(c.t), id: { lt: c.id } },
          ]
        : [
            // 主键同值且游标的 publishedAt 为空：null 区里只能再按 id 决胜。
            // 注意不能写成 publishedAt: { lt: ... } —— 唯一可能与 c.k 并列的 null 行就在这里。
            { ...atMajor, publishedAt: null, id: { lt: c.id } },
          ]),
    ].map((x) => x as Prisma.ResourceWhereInput),
  };
}

// 分类/标签是低频变更的公共数据：跨请求缓存，后台 taxonomy 写入后按标签失效。
export const TAXONOMY_CACHE_TAG = "content:taxonomy";

const readCachedCategories = cachedInRequest(
  async () => prisma.category.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] }),
  ["categories"],
  { tags: [TAXONOMY_CACHE_TAG], revalidate: 300 },
);

// limit 是数值参数，映射成字符串进缓存键（cachedInRequestWithArgs 的 A 约束为 string）
const readCachedTopTags = cachedInRequestWithArgs(
  async (limit: string) =>
    prisma.tag.findMany({
      orderBy: { count: "desc" },
      take: Number(limit),
      select: { slug: true, name: true, count: true },
    }),
  ["top-tags"],
  { tags: [TAXONOMY_CACHE_TAG], revalidate: 300 },
);

// 请求内去重：Navbar 分类菜单、sidebar widget、首页 categories 板块常在同页重复取。
export const getCategories = cache(async () => readCachedCategories());

export const getTopTags = cache(async (limit = 24) => readCachedTopTags(String(limit)));

export type ResourceDetail = Awaited<ReturnType<typeof getResourceDetail>>;

// cache()：同请求内 metadata 与 page 各调一次时只查一遍库（两处须传相同 viewerId）
export const getResourceDetail = cache(async (slug: string, viewerId?: string) => {
  const where: Prisma.ResourceWhereInput = { slug };
  if (!viewerId) where.status = "PUBLISHED";

  const resource = await prisma.resource.findFirst({
    where,
    include: {
      author: {
        select: {
          id: true,
          username: true,
          name: true,
          // 详情页作者栏要渲染昵称特效色（AuthorIdentity），随 author 一次取出
          nameColor: true,
          avatarKey: true,
          bio: true,
          // 资源详情页也要铺作者的主页背景（开关 + 等级门槛在页面里判定），随 author 一次取出
          profileBgPcKey: true,
          profileBgOnResource: true,
          profileBgMask: true,
          role: true,
          trusted: true,
          createdAt: true,
          lastSeenAt: true,
          _count: { select: { resources: true, followers: true } },
        },
      },
      category: { select: { slug: true, name: true } },
      tags: { select: { tag: { select: { slug: true, name: true } } } },
      media: {
        where: { resourceId: { not: null } },
        orderBy: { sort: "asc" },
        select: {
          id: true,
          thumbKey: true,
          bigKey: true,
          storageKey: true,
          width: true,
          height: true,
          placeholder: true,
        },
      },
      versions: { orderBy: { createdAt: "desc" }, take: 20 },
      _count: { select: { likes: true } },
    },
  });
  if (!resource) return null;

  const gallery = resource.media.map((m) => ({
    id: m.id,
    thumbUrl: m.thumbKey ? publicUrl(m.thumbKey) : publicUrl(m.storageKey),
    bigUrl: m.bigKey ? publicUrl(m.bigKey) : publicUrl(m.storageKey),
    width: m.width,
    height: m.height,
    placeholder: m.placeholder,
  }));

  let viewerStates = {
    liked: false,
    favorited: false,
    favoriteCollectionId: null as string | null,
    followingAuthor: false,
  };
  if (viewerId) {
    const [lk, fv, fl] = await Promise.all([
      prisma.like.findUnique({
        where: { userId_resourceId: { userId: viewerId, resourceId: resource.id } },
        select: { id: true },
      }),
      prisma.favorite.findUnique({
        where: { userId_resourceId: { userId: viewerId, resourceId: resource.id } },
        select: { collectionId: true },
      }),
      prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: viewerId, followingId: resource.authorId } },
        select: { followerId: true },
      }),
    ]);
    viewerStates = {
      liked: !!lk,
      favorited: !!fv,
      favoriteCollectionId: fv?.collectionId ?? null,
      followingAuthor: !!fl,
    };
  }

  // 评论区第一页：根楼层按 createdAt 倒序（最新在前），每个根只展开第 1 页回复。
  // 后续页与子评论翻页走 loadRootCommentsAction / loadRepliesAction，不再一次性全量取数。
  const commentsPage = await fetchRootCommentsPage(resource.id, 1);

  // media 已映射为 gallery，不再随返回值重复序列化（原对象含多个 storage key 字段）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { media: _media, ...resourceRest } = resource;
  return {
    ...resourceRest,
    gallery,
    author: {
      id: resource.author.id,
      username: resource.author.username,
      name: resource.author.name,
      nameColor: resource.author.nameColor,
      avatarKey: resource.author.avatarKey ? publicUrl(resource.author.avatarKey) : null,
      bio: resource.author.bio,
      // 资源页背景用。注意口径：这两个是**未解析的存储 key / 布尔**，页面侧还要 publicUrl()，
      // 与上面 avatarKey（已解析成 URL）不同 —— 别照着 avatarKey 的用法直接塞进 <img src>。
      profileBgPcKey: resource.author.profileBgPcKey,
      profileBgOnResource: resource.author.profileBgOnResource,
      profileBgMask: resource.author.profileBgMask,
      role: resource.author.role,
      trusted: resource.author.trusted,
      createdAt: resource.author.createdAt,
      resourceCount: resource.author._count.resources,
      followerCount: resource.author._count.followers,
      online: isOnline(resource.author.lastSeenAt),
    },
    comments: commentsPage.roots,
    commentsPaging: { ...commentsPage.paging, commentTotal: commentsPage.commentTotal },
    viewer: viewerStates,
  };
});

// ---------- 相关推荐 ----------
// 打分排序：同分类 + 同标签（权重最高）+ 同类型 + 热度（点赞/浏览/下载，对数归一）+ 时效衰减。
// 候选来自三个池（同分类热门 / 同标签热门 / 同类型热门），合并去重后统一打分取前 LIMIT。
export type RelatedSeed = {
  id: string;
  type: ResourceType;
  category: { slug: string } | null;
  tags: { slug: string }[];
};

export async function getRelated(resource: RelatedSeed): Promise<FeedCard[]> {
  const LIMIT = 6;
  const seen = new Set<string>([resource.id]);
  const pool: FeedItem[] = [];
  const push = (items: FeedItem[]) => {
    for (const i of items) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      pool.push(i);
    }
  };

  const poolRequests: Promise<{ items: FeedItem[] }>[] = [];
  if (resource.category) {
    poolRequests.push(
      getFeed({
        categorySlug: resource.category.slug,
        sort: "popular",
        pageSize: LIMIT * 2,
        withTags: true, // relatedScore 要按共享标签打分
      }),
    );
  }
  if (resource.tags.length > 0) {
    poolRequests.push(
      getFeed({
        tagSlugs: resource.tags.map((t) => t.slug),
        sort: "popular",
        pageSize: LIMIT * 2,
        withTags: true, // relatedScore 要按共享标签打分
      }),
    );
  }
  // 同类型热门池兜底（分类/标签池不足时补足多样性）；三个候选池并行取数，仍按原顺序合并。
  // 这个池同样要进 relatedScore，所以也得带 tags —— 漏掉它会让兜底池的共享标签权重恒为 0，
  // 打分悄悄偏向其它两个池，是那种「不报错但排序变了」的隐性 bug。
  poolRequests.push(
    getFeed({ type: resource.type, sort: "popular", pageSize: LIMIT * 2, withTags: true }),
  );
  const pools = await Promise.all(poolRequests);
  for (const { items } of pools) push(items);

  const baseTags = new Set(resource.tags.map((t) => t.slug));
  return pool
    .map((it) => ({ it, s: relatedScore(resource, baseTags, it) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, LIMIT)
    .map((x) => toFeedCard(x.it));
}

function relatedScore(
  base: { category: { slug: string } | null; type: string },
  baseTags: Set<string>,
  cand: FeedItem,
): number {
  let s = 0;
  if (base.category?.slug && cand.category?.slug === base.category.slug) s += 6;
  let shared = 0;
  for (const t of cand.tags) if (baseTags.has(t.slug)) shared++;
  s += shared * 2.5;
  if (base.type === cand.type) s += 1.5;
  s +=
    Math.log10(1 + cand.likeCount) * 0.6 +
    Math.log10(1 + cand.viewCount) * 0.35 +
    Math.log10(1 + cand.downloadCount) * 0.5;
  if (cand.publishedAt) {
    const ageDays = (Date.now() - cand.publishedAt.getTime()) / 86_400_000;
    s += ageDays < 30 ? 1.2 : ageDays < 90 ? 0.6 : ageDays < 365 ? 0.2 : 0;
  }
  return s;
}

// ---------- 首页「为你推荐」----------
// 登录用户：构建「用户画像」（综合点赞/收藏/评论/关注的加权、带时间衰减信号）做内容相似度
// + 质量 + 新颖度打分；并通过「探索槽位 + MMR 多样性选择 + 最少分类覆盖」主动打破信息茧房。
// 游客 / scope=all：按配置回退全站热门。
export type RecommendScope = "personal" | "all";

export type RecommendOpts = {
  userId?: string;
  count?: number;
  scope?: RecommendScope;
  /** personalized=画像精准推荐；explore=随机探索（每次刷新换一批，打破信息茧房） */
  mode?: "personalized" | "explore";
  type?: ResourceType | "ALL";
  categorySlugs?: string[];
  /** 探索（打破信息茧房）槽位占比 0–0.6，默认 0.3 */
  explorationRatio?: number;
  /** 最终列表最少覆盖的不同分类数，0 = 自动 min(3, count) */
  minCategories?: number;
  /** 热度时间窗口：all=累计全时间；week/month=仅统计近期发布资源（实现「近期热门」） */
  period?: "all" | "week" | "month";
};

// 各信号基础权重：收藏 > 评论 > 点赞；关注创作者单独计权重
const SIGNAL_WEIGHT = { like: 1.0, favorite: 2.0, comment: 1.5, follow: 1.2 } as const;
// 时间衰减半衰期（天）：越早的互动影响力越低，使画像紧跟近期习惯
const HALF_LIFE_DAYS = 90;
const DAY = 86_400_000;
// 打分权重
const W_QUAL = 1.0;
const W_NOV = 0.6;
// 相似度归一化后低于此值视为「圈外内容」，用于探索槽位
const EXPLORE_SIM = 0.15;
// MMR 多样性惩罚强度
const MMR_LAMBDA = 0.7;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---- 用户画像 ----
type RecProfile = {
  tagW: Map<string, number>;
  catW: Map<string, number>;
  typeW: Map<ResourceType, number>;
  authorW: Map<string, number>; // 关注的创作者 / 高频互动作者
  totalWeight: number;
  signalCount: number;
  engagedIds: string[]; // 已互动资源，候选池排除，避免重复推荐
};

type EngagedResource = {
  id: string;
  type: ResourceType;
  authorId: string;
  category: { slug: string | null } | null;
  tags: { tag: { slug: string } }[];
};

async function buildRecProfile(userId: string): Promise<RecProfile> {
  const now = Date.now();
  const decay = (createdAt: Date) =>
    Math.pow(0.5, (now - createdAt.getTime()) / (HALF_LIFE_DAYS * DAY));

  const tagW = new Map<string, number>();
  const catW = new Map<string, number>();
  const typeW = new Map<ResourceType, number>();
  const authorW = new Map<string, number>();
  const engagedIds: string[] = [];

  const accTag = (slug: string, w: number) => tagW.set(slug, (tagW.get(slug) ?? 0) + w);
  const accCat = (slug: string | null, w: number) => {
    if (slug) catW.set(slug, (catW.get(slug) ?? 0) + w);
  };
  const accType = (t: ResourceType, w: number) => typeW.set(t, (typeW.get(t) ?? 0) + w);
  const accAuthor = (id: string, w: number) => authorW.set(id, (authorW.get(id) ?? 0) + w);

  const resSelect = {
    id: true,
    type: true,
    authorId: true,
    category: { select: { slug: true } },
    tags: { select: { tag: { select: { slug: true } } } },
  } satisfies Prisma.ResourceSelect;

  const [likes, favorites, comments, follows] = await prisma.$transaction([
    prisma.like.findMany({
      where: { userId },
      take: 120,
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, resource: { select: resSelect } },
    }),
    prisma.favorite.findMany({
      where: { userId },
      take: 120,
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, resource: { select: resSelect } },
    }),
    prisma.comment.findMany({
      where: { authorId: userId },
      take: 120,
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, resource: { select: resSelect } },
    }),
    prisma.follow.findMany({
      where: { followerId: userId },
      take: 120,
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, followingId: true },
    }),
  ]);

  let signalCount = 0;
  const ingest = (createdAt: Date, weight: number, res: EngagedResource) => {
    const w = weight * decay(createdAt);
    if (w <= 0) return;
    signalCount++;
    accType(res.type, w);
    accCat(res.category?.slug ?? null, w);
    for (const t of res.tags) accTag(t.tag.slug, w);
    accAuthor(res.authorId, w * 0.5); // 互动过的作者也反映口味
  };

  const pushRes = (createdAt: Date, weight: number, res: EngagedResource | null) => {
    if (!res) return;
    engagedIds.push(res.id);
    ingest(createdAt, weight, res);
  };

  for (const l of likes) pushRes(l.createdAt, SIGNAL_WEIGHT.like, l.resource);
  for (const f of favorites) pushRes(f.createdAt, SIGNAL_WEIGHT.favorite, f.resource);
  for (const c of comments) pushRes(c.createdAt, SIGNAL_WEIGHT.comment, c.resource);
  for (const f of follows) {
    const w = SIGNAL_WEIGHT.follow * decay(f.createdAt);
    if (w > 0) {
      signalCount++;
      accAuthor(f.followingId, w);
    }
  }

  let totalWeight = 0;
  for (const v of tagW.values()) totalWeight += v;
  for (const v of catW.values()) totalWeight += v;
  for (const v of typeW.values()) totalWeight += v;
  for (const v of authorW.values()) totalWeight += v;

  return { tagW, catW, typeW, authorW, totalWeight, signalCount, engagedIds };
}

// 推荐专属取数字段（含 author.id 供作者亲和度打分；不复用共享 feedSelect 以保持最小改动）
const recSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  type: true,
  publishedAt: true,
  createdAt: true,
  likeCount: true,
  viewCount: true,
  favoriteCount: true,
  commentCount: true,
  downloadCount: true,
  loginRequired: true,
  nsfw: true,
  coverMedia: { select: coverSelect },
  author: { select: { id: true, username: true, name: true, nameColor: true } },
  category: { select: { slug: true, name: true } },
  tags: { select: { tag: { select: { slug: true, name: true } } } },
} satisfies Prisma.ResourceSelect;

type RecRow = Prisma.ResourceGetPayload<{ select: typeof recSelect }>;
type RecItem = FeedItem & { authorId: string };
const toRecItem = (r: RecRow): RecItem => ({ ...toFeedItem(r), authorId: r.author.id });

type Scored = {
  item: RecItem;
  sim: number; // 画像相似度（绝对权重）
  simNorm: number; // 归一化 0..1
  quality: number;
  novelty: number;
  rank: number; // 个性化综合分
};

function scoreCandidates(items: RecItem[], p: RecProfile, now: number): Scored[] {
  return items.map((it) => {
    let sim = 0;
    let matched = false;
    for (const t of it.tags) {
      const w = p.tagW.get(t.slug);
      if (w) {
        sim += w;
        matched = true;
      }
    }
    const cw = it.category?.slug ? p.catW.get(it.category.slug) : undefined;
    if (cw) {
      sim += cw * 1.3;
      matched = true;
    }
    const tw = p.typeW.get(it.type) ?? 0;
    if (tw) {
      sim += tw * 0.8;
      matched = true;
    }
    const aw = p.authorW.get(it.authorId);
    if (aw) {
      sim += aw * 1.0;
      matched = true;
    }
    const quality =
      Math.log10(1 + it.likeCount) * 0.5 +
      Math.log10(1 + it.viewCount) * 0.25 +
      Math.log10(1 + it.downloadCount) * 0.4 +
      Math.log10(1 + it.favoriteCount) * 0.3;
    const ageDays = it.publishedAt ? (now - it.publishedAt.getTime()) / DAY : 9999;
    const novelty = ageDays < 30 ? 1.0 : ageDays < 90 ? 0.6 : ageDays < 180 ? 0.3 : 0.1;
    // 完全无交集仅轻微降权（仍可能因质量/新颖度少量入选，保证不空白）
    if (!matched) sim -= 0.5;
    const simNorm = p.totalWeight > 0 ? clamp(sim / (p.totalWeight * 0.5), 0, 1) : 0;
    const rank = sim * 2 + quality * W_QUAL + novelty * W_NOV;
    return { item: it, sim, simNorm, quality, novelty, rank };
  });
}

// 两资源间的相似度（0..1）：同分类最强，共享标签次之，同作者补充
function itemSim(a: RecItem, b: RecItem): number {
  let s = 0;
  if (a.category?.slug && a.category.slug === b.category?.slug) s = 1;
  const ta = new Set(a.tags.map((t) => t.slug));
  let shared = 0;
  for (const t of b.tags) if (ta.has(t.slug)) shared++;
  s = Math.max(s, Math.min(1, shared * 0.5));
  if (a.authorId === b.authorId) s = Math.max(s, 0.3);
  return s;
}

// 多样性选择：先放探索槽位（圈外高质量），再用 MMR 兼顾相关性与多样性，最后补齐最少分类覆盖
function diverseSelect(
  scored: Scored[],
  count: number,
  explorationRatio: number,
  minCategories: number,
): FeedCard[] {
  const explorePool = scored
    .filter((s) => s.simNorm < EXPLORE_SIM)
    .sort((a, b) => b.quality + b.novelty - (a.quality + a.novelty));
  const personalPool = scored
    .filter((s) => s.simNorm >= EXPLORE_SIM)
    .sort((a, b) => b.rank - a.rank);

  const picked: Scored[] = [];
  const contains = (x: Scored) => picked.some((p) => p.item.id === x.item.id);
  const penalty = (cand: Scored) => {
    let m = 0;
    for (const p of picked) m = Math.max(m, itemSim(cand.item, p.item));
    return m;
  };
  const takeBest = (pool: Scored[], val: (s: Scored) => number) => {
    let bi = -1;
    let bs = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      if (contains(pool[i])) continue;
      const v = val(pool[i]) - MMR_LAMBDA * penalty(pool[i]);
      if (v > bs) {
        bs = v;
        bi = i;
      }
    }
    if (bi >= 0) picked.push(pool[bi]);
  };

  // 1) 先放探索槽位，主动打破信息茧房（推荐用户「没怎么接触过」的优质/新内容）
  const exploreN = Math.min(Math.round(count * explorationRatio), explorePool.length);
  for (let i = 0; i < exploreN; i++) takeBest(explorePool, (s) => s.quality + s.novelty);

  // 2) 其余个性化槽位，MMR 在相关性与多样性间权衡
  while (picked.length < count) {
    takeBest(personalPool, (s) => s.rank);
    if (picked.length >= count) break;
    const before = picked.length;
    // 个性化池耗尽则回退到全池（按质量 + 新颖度）
    takeBest(scored, (s) => s.quality + s.novelty);
    if (picked.length === before) break; // 无更多可选
  }

  // 3) 保证最少覆盖分类数，避免整页同质（信息茧房的最终兜底）
  const wantCats = minCategories > 0 ? minCategories : Math.min(3, count);
  const haveCats = new Set(picked.map((p) => p.item.category?.slug));
  if (haveCats.size < wantCats) {
    const missing = wantCats - haveCats.size;
    const forNewCat = scored
      .filter((s) => !contains(s) && !haveCats.has(s.item.category?.slug))
      .sort((a, b) => b.quality + b.novelty - (a.quality + a.novelty));
    for (let i = 0; i < missing && i < forNewCat.length; i++) {
      const add = forNewCat[i];
      // 用新分类候选项替换分最低的个性化项（保留探索项）
      let lowIdx = -1;
      let low = Infinity;
      picked.forEach((p, idx) => {
        if (p.simNorm >= EXPLORE_SIM && p.rank < low) {
          low = p.rank;
          lowIdx = idx;
        }
      });
      if (lowIdx >= 0) picked.splice(lowIdx, 1, add);
      else if (picked.length < count) picked.push(add);
    }
  }

  return picked.map((p) => toFeedCard(p.item));
}

/** 候选池：质量池（高互动经典）+ 新鲜池（近 180 天），合并去重；排除指定用户已互动与其本人作品 */
async function buildCandidatePool(
  opts: RecommendOpts,
  userId?: string,
  excludeIds?: string[],
): Promise<RecItem[]> {
  const excl = excludeIds ?? [];
  const where: Prisma.ResourceWhereInput = {
    status: "PUBLISHED",
    authorId: userId ? { not: userId } : undefined,
    id: excl.length ? { notIn: excl } : undefined,
  };
  if (opts.type && opts.type !== "ALL") where.type = opts.type;
  if (opts.categorySlugs && opts.categorySlugs.length > 0)
    where.category = { slug: { in: opts.categorySlugs } };

  const recentCut = new Date(Date.now() - 180 * DAY);
  // 热度时间窗口：近期热门 → 收紧候选池发布时间下限（取窗口与 180 天新鲜池的更紧者）
  const periodCut =
    opts.period && opts.period !== "all"
      ? new Date(Date.now() - (opts.period === "month" ? 30 : 7) * DAY)
      : null;
  const freshCut = periodCut && periodCut > recentCut ? periodCut : recentCut;
  const [quality, fresh] = await Promise.all([
    prisma.resource.findMany({
      where: periodCut ? { ...where, publishedAt: { gte: periodCut } } : where,
      orderBy: [{ likeCount: "desc" }, { publishedAt: "desc" }],
      take: 250,
      select: recSelect,
    }),
    prisma.resource.findMany({
      where: { ...where, publishedAt: { gte: freshCut } },
      orderBy: [{ publishedAt: "desc" }, { likeCount: "desc" }],
      take: 250,
      select: recSelect,
    }),
  ]);
  const poolMap = new Map<string, RecRow>();
  for (const r of quality) poolMap.set(r.id, r);
  for (const r of fresh) poolMap.set(r.id, r);
  return [...poolMap.values()].map(toRecItem);
}

/** Fisher-Yates 原地洗牌（探索模式逐次刷新不同） */
function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

const EMPTY_PROFILE: RecProfile = {
  tagW: new Map(),
  catW: new Map(),
  typeW: new Map(),
  authorW: new Map(),
  totalWeight: 0,
  signalCount: 0,
  engagedIds: [],
};

/** 探索模式：对候选按「质量+新颖度」取前 3×count，洗牌后抽 count，每次刷新结果不同 */
function exploreSelect(candidates: RecItem[], count: number): FeedCard[] {
  const scored = scoreCandidates(candidates, EMPTY_PROFILE, Date.now());
  scored.sort((a, b) => b.quality + b.novelty - (a.quality + a.novelty));
  const k = Math.min(scored.length, count * 3);
  const top = scored.slice(0, k);
  shuffle(top);
  return top.slice(0, count).map((p) => toFeedCard(p.item));
}

/** 回退：全站热门（游客 / 无信号 / 探索池为空时兜底），保证不空白 */
async function popularFallback(opts: RecommendOpts, count: number): Promise<FeedCard[]> {
  const { items } = await getFeed({
    type: opts.type,
    sort: "popular",
    pageSize: count,
    categorySlugs: opts.categorySlugs,
    period: opts.period && opts.period !== "all" ? opts.period : undefined,
  });
  return items.map(toFeedCard);
}

export async function getRecommendations(opts: RecommendOpts): Promise<FeedCard[]> {
  const count = Math.max(1, Math.min(48, opts.count ?? 12));

  // 探索模式：不依赖画像，基于质量+新颖度随机抽样，每次刷新换一批内容（打破信息茧房）
  if (opts.mode === "explore") {
    noStore(); // 确保逐次请求实时计算，不被静态/路由缓存冻结
    const excludeIds = opts.userId ? (await buildRecProfile(opts.userId)).engagedIds : [];
    const candidates = await buildCandidatePool(opts, opts.userId, excludeIds);
    if (candidates.length === 0) return popularFallback(opts, count);
    return exploreSelect(candidates, count);
  }

  const personal = !!opts.userId && opts.scope !== "all";
  if (!personal) return popularFallback(opts, count);

  const userId = opts.userId!;
  const profile = await buildRecProfile(userId);

  // 无信号 → 回退热门（与游客一致），保证不空白
  if (profile.signalCount === 0) return popularFallback(opts, count);

  // 候选池：质量池（已被验证的好内容）+ 新鲜池（近 180 天新内容）合并去重，
  // 兼顾经典与新鲜，从根源降低「只看老内容」的茧房倾向。
  const candidates = await buildCandidatePool(opts, userId, profile.engagedIds);
  if (candidates.length === 0) return popularFallback(opts, count);

  // 探索占比：弱画像 / 冷启动时更高，主动拓宽视野；强画像按配置收敛到精准
  const cold = profile.signalCount < 3;
  const explorationRatio = Math.min(0.7, clamp(opts.explorationRatio ?? 0.3, 0, 0.6) * (cold ? 1.4 : 1));
  const minCategories = opts.minCategories && opts.minCategories > 0 ? opts.minCategories : 0;

  const scored = scoreCandidates(candidates, profile, Date.now());
  return diverseSelect(scored, count, explorationRatio, minCategories);
}

// ---------- 个人主页 ----------
export type UserProfile = {
  id: string;
  username: string;
  name: string | null;
  bio: string | null;
  avatarKey: string | null;
  heroImageKey: string | null;
  /** 个人主页背景（铺满视口的最底层底图，仅桌面端渲染）；是否真的有资格渲染由 profileBgUnlocked 判定 */
  profileBgPcKey: string | null;
  /** 该用户自定义的背景遮罩（原始值，渲染前经 safeBgMask 收口）；null = 用内置默认 */
  profileBgMask: string | null;
  /** 昵称特效色 key；实际渲染走 components/ui/Nickname（读激励配置开关） */
  nameColor: string | null;
  role: "USER" | "MODERATOR" | "ADMIN";
  trusted: boolean;
  createdAt: Date;
  resourceCount: number;
  followerCount: number;
  followingCount: number;
  // 主页隐私开关：对应列表/收藏 tab 是否对非本人访客可见（本人始终可见）
  showFavorites: boolean;
  showFollowers: boolean;
  showFollowing: boolean;
  // 邮件通知开关（仅设置页使用，公开主页不展示）
  emailNotifyComment: boolean;
  emailNotifyModeration: boolean;
  // 站内通知开关（仅设置页使用）
  inAppNotifyLike: boolean;
  inAppNotifyComment: boolean;
  inAppNotifyFollow: boolean;
  inAppNotifySystem: boolean;
  isViewer: boolean;
  following: boolean;
  online: boolean;
};

// cache()：同请求内 metadata 与 page 各调一次时只查一遍库（两处须传相同 viewerId）
export const getProfile = cache(
  async (username: string, viewerId?: string): Promise<UserProfile | null> => {
    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        name: true,
        bio: true,
        avatarKey: true,
        heroImageKey: true,
        profileBgPcKey: true,
        profileBgMask: true,
        nameColor: true,
        role: true,
        trusted: true,
        createdAt: true,
        lastSeenAt: true,
        showFavorites: true,
        showFollowers: true,
        showFollowing: true,
        emailNotifyComment: true,
        emailNotifyModeration: true,
        inAppNotifyLike: true,
        inAppNotifyComment: true,
        inAppNotifyFollow: true,
        inAppNotifySystem: true,
        _count: { select: { resources: true, followers: true, following: true } },
      },
    });
    if (!user) return null;
    const isViewer = viewerId === user.id;
    let following = false;
    if (viewerId && !isViewer) {
      following = !!(await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: viewerId, followingId: user.id } },
        select: { followerId: true },
      }));
    }
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      bio: user.bio,
      avatarKey: user.avatarKey,
      heroImageKey: user.heroImageKey,
      profileBgPcKey: user.profileBgPcKey,
      profileBgMask: user.profileBgMask,
      nameColor: user.nameColor,
      role: user.role,
      trusted: user.trusted,
      createdAt: user.createdAt,
      resourceCount: user._count.resources,
      followerCount: user._count.followers,
      followingCount: user._count.following,
      showFavorites: user.showFavorites,
      showFollowers: user.showFollowers,
      showFollowing: user.showFollowing,
      emailNotifyComment: user.emailNotifyComment,
      emailNotifyModeration: user.emailNotifyModeration,
      inAppNotifyLike: user.inAppNotifyLike,
      inAppNotifyComment: user.inAppNotifyComment,
      inAppNotifyFollow: user.inAppNotifyFollow,
      inAppNotifySystem: user.inAppNotifySystem,
      isViewer,
      following,
      online: isOnline(user.lastSeenAt),
    };
  },
);

// ---------- 收藏夹 ----------
export type CollectionRow = { id: string; name: string; count: number };

export async function getCollections(userId: string): Promise<CollectionRow[]> {
  const rows = await prisma.collection.findMany({
    where: { ownerId: userId },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, name: true, _count: { select: { items: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, count: r._count.items }));
}

// 收藏夹详情：owner 本人或 isPublic 才可见；条目按收藏时间倒序（FeedCard 形状喂 ResourceGrid）
// cache()：同请求内 metadata 与 page 各调一次时只查一遍库（两处须传相同 viewerId）
export const getCollectionDetail = cache(async (id: string, viewerId?: string) => {
  const col = await prisma.collection.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, username: true, name: true, nameColor: true } },
      items: {
        orderBy: { createdAt: "desc" },
        take: 100,
        // 只展示已上架资源：未发布/被下架内容不能经公开夹子绕过 detail 页守卫；
        // D9：公开夹子对未登录访客同样不暴露 NSFW 项
        where: {
          resource: {
            status: "PUBLISHED",
            ...(viewerId ? {} : { nsfw: false }),
          },
        },
        include: {
          resource: { select: feedSelect },
        },
      },
    },
  });
  if (!col) return null;
  if (!col.isPublic && col.ownerId !== viewerId) return null;
  return {
    id: col.id,
    name: col.name,
    description: col.description,
    isPublic: col.isPublic,
    isOwner: col.ownerId === viewerId,
    owner: col.owner,
    createdAt: col.createdAt,
    items: col.items.map((f) => toFeedCard(toFeedItem(f.resource as FeedRow))),
  };
});

// ---------- 通知 ----------
export type NotificationRow = {
  id: string;
  type: string;
  readAt: Date | null;
  createdAt: Date;
  message: string | null;
  /** 点赞聚合人数：>1 时文案显示「X 等 N 人赞了你」 */
  count: number;
  resource: { slug: string; title: string } | null;
  actor: { username: string; name: string | null } | null;
  commentId: string | null;
};

export type NotificationFilter = "LIKE" | "COMMENT" | "FOLLOW" | "SYSTEM" | "SECURITY";

/** 每页条数：通知可能成千上万条，只取第一页会让老通知永远看不到 */
export const NOTIFICATION_PAGE_SIZE = 20;

/** 通知列表 where：页面筛选与未读数共用，避免两处范围漂移 */
function notificationWhere(userId: string, filter?: NotificationFilter): Prisma.NotificationWhereInput {
  return {
    userId,
    ...(filter === "SYSTEM"
      ? { type: { in: ["MODERATION", "SYSTEM"] } } // 「系统」页含审核结果 + 系统公告
      : filter
        ? { type: filter }
        : {}),
  };
}

export async function getNotifications(
  userId: string,
  filter?: NotificationFilter,
  pageRaw = 1,
): Promise<{ rows: NotificationRow[]; unread: number; total: number; page: number; hasMore: boolean }> {
  const where = notificationWhere(userId, filter);
  const total = await prisma.notification.count({ where });
  const pages = Math.max(1, Math.ceil(total / NOTIFICATION_PAGE_SIZE));
  // 页码兜底：筛选切换后旧页码可能越界，clamp 到最后一页而不是给空列表
  const page = Math.min(Math.max(1, Math.floor(pageRaw) || 1), pages);

  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * NOTIFICATION_PAGE_SIZE,
      take: NOTIFICATION_PAGE_SIZE,
      select: {
        id: true,
        type: true,
        readAt: true,
        createdAt: true,
        message: true,
        count: true,
        resourceId: true,
        actorId: true,
        commentId: true,
      },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  // Notification 只存 resourceId / actorId 标量（schema 未建 relation），需二次查询补全
  const rids = [...new Set(rows.map((r) => r.resourceId).filter((x): x is string => !!x))];
  const aIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const [resourceRows, actorRows] = await Promise.all([
    rids.length
      ? prisma.resource.findMany({
          where: { id: { in: rids } },
          select: { id: true, slug: true, title: true },
        })
      : [],
    aIds.length
      ? prisma.user.findMany({
          where: { id: { in: aIds } },
          select: { id: true, username: true, name: true },
        })
      : [],
  ]);
  const resMap = new Map(resourceRows.map((r) => [r.id, r] as const));
  const actorMap = new Map(actorRows.map((u) => [u.id, u] as const));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type,
      readAt: r.readAt,
      createdAt: r.createdAt,
      message: r.message,
      count: r.count,
      resource: r.resourceId ? (resMap.get(r.resourceId) ?? null) : null,
      actor: r.actorId ? (actorMap.get(r.actorId) ?? null) : null,
      commentId: r.commentId,
    })),
    unread,
    total,
    page,
    hasMore: page * NOTIFICATION_PAGE_SIZE < total,
  };
}

// ---------- 侧边栏组件取数（SiteSidebar widgets 共用） ----------

/** 按 slug 列表取标签（保持传入顺序；不存在的 slug 忽略） */
export async function getTagsBySlugs(slugs: string[]) {
  const rows = await prisma.tag.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, name: true, count: true },
  });
  const order = new Map(rows.map((t) => [t.slug, t]));
  return slugs.flatMap((s) => (order.get(s) ? [order.get(s)!] : []));
}

/** 最新公开评论（仅已上架资源；含作者与所属资源摘要） */
export function getRecentComments(limit: number) {
  return prisma.comment.findMany({
    where: { status: "PUBLIC", resource: { status: "PUBLISHED" } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      content: true,
      createdAt: true,
      author: {
        select: { id: true, username: true, name: true, nameColor: true, avatarKey: true, lastSeenAt: true },
      },
      resource: { select: { slug: true, title: true } },
    },
  });
}

/** 随机「手气不错」id 池：轻量 id 池洗牌后精取（SQLite 无原生 random 排序；池子封顶 500） */
export async function getRandomResourceIds(count: number, includeNsfw?: boolean) {
  // D9：随机池对游客同样不含 NSFW（getFeed 二次精取还有兜底，池内提前滤更省）
  const allowNsfw = includeNsfw ?? (await viewerAuthed());
  const pool = await prisma.resource.findMany({
    where: { status: "PUBLISHED", ...(allowNsfw ? {} : { nsfw: false }) },
    select: { id: true },
    take: 500,
    orderBy: { createdAt: "desc" },
  });
  return [...pool]
    .sort(() => Math.random() - 0.5)
    .slice(0, count)
    .map((r) => r.id);
}
