import { publicUrl } from "@/lib/storage";
import { prisma } from "@/lib/db/prisma";
import { isOnline } from "@/lib/online";
import { auth } from "@/lib/auth";
import { searchRuntime } from "@/lib/search";
import { cache } from "react";
import type { Prisma, ResourceType } from "@prisma/client";

export type FeedItem = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  type: "GAME" | "IMAGE" | "ARTICLE";
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
  author: { username: string; name: string | null };
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
  type: "GAME" | "IMAGE" | "ARTICLE";
  likeCount: number;
  viewCount: number;
  favoriteCount: number;
  commentCount: number;
  downloadCount: number;
  loginRequired: boolean;
  nsfw: boolean;
  category: { slug: string; name: string } | null;
  author: { username: string; name: string | null };
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
  tags: { tag: { slug: string; name: string } }[];
  author: { username: string; name: string | null };
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
  author: { select: { username: true, name: true } },
  category: { select: { slug: true, name: true } },
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
    tags: r.tags?.map((t) => ({ slug: t.tag.slug, name: t.tag.name })) ?? [],
    author: { username: r.author.username, name: r.author.name },
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
async function viewerAuthed(): Promise<boolean> {
  try {
    return !!(await auth())?.user;
  } catch {
    return false;
  }
}

export async function getFeed(
  params: FeedParams,
): Promise<{ items: FeedItem[]; page: number; hasMore: boolean }> {
  const page = Math.max(1, params.page ?? 1);
  // D9：游客（含搜索引擎）只见 SFW；登录后全站可见
  const allowNsfw = params.includeNsfw ?? (await viewerAuthed());
  const pageSize = Math.max(1, Math.min(48, params.pageSize ?? 24));

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
      if (ids.length === 0) return { items: [], page, hasMore: false };
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
    if (total === 0) return { items: [], page, hasMore: false };
    const pageIds = ordered.slice((page - 1) * pageSize, page * pageSize);
    if (pageIds.length === 0) return { items: [], page, hasMore: false };
    const fetched = await prisma.resource.findMany({
      where: { id: { in: pageIds } },
      select: feedSelect,
    });
    const byId = new Map(fetched.map((r) => [r.id, r]));
    const rows = pageIds
      .map((id) => byId.get(id))
      .filter((r): r is FeedRow => !!r);
    return { items: rows.map(toFeedItem), page, hasMore: page * pageSize < total };
  }

  // 排序带 id 决胜：同值时结果稳定（分页翻页不跳动）
  const orderBy: Prisma.ResourceOrderByWithRelationInput[] =
    params.sort === "popular"
      ? [{ likeCount: "desc" }, { publishedAt: "desc" }, { id: "desc" }]
      : params.sort === "downloads"
        ? [{ downloadCount: "desc" }, { publishedAt: "desc" }, { id: "desc" }]
        : [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }];

  const rows = await prisma.resource.findMany({
    where,
    orderBy,
    take: pageSize + 1,
    skip: (page - 1) * pageSize,
    select: feedSelect,
  });
  const hasMore = rows.length > pageSize;
  return { items: rows.slice(0, pageSize).map(toFeedItem), page, hasMore };
}

// 请求内去重：Navbar 分类菜单、sidebar widget、首页 categories 板块常在同页重复取
export const getCategories = cache(async () => {
  return prisma.category.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] });
});

export const getTopTags = cache(async (limit = 24) => {
  return prisma.tag.findMany({
    orderBy: { count: "desc" },
    take: limit,
    select: { slug: true, name: true, count: true },
  });
});

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
          avatarKey: true,
          bio: true,
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

  // 一次取评论（软上限：取最新 200 条再正序），在内存里展平：二级以下的回复全部挂到根楼层下（按时间序），
  // 避免嵌套多层；深层回复带上 replyTo（被回复人）供 UI 显示 "回复 @xx"
  const allComments = (
    await prisma.comment.findMany({
      where: { resourceId: resource.id, status: "PUBLIC" },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        author: {
          select: {
            username: true,
            name: true,
            avatarKey: true,
            bio: true,
            role: true,
            trusted: true,
            createdAt: true,
          },
        },
        media: {
          orderBy: { sort: "asc" },
          select: { storageKey: true, width: true, height: true },
        },
      },
    })
  ).reverse();
  // 用户 hover 卡片统计（作品数/关注者数）+ 在线状态，authorId 批量查一次
  const authorIds = [...new Set(allComments.map((c) => c.authorId))];
  const authorStats = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: {
      id: true,
      lastSeenAt: true,
      _count: { select: { resources: true, followers: true } },
    },
  });
  const statsMap = new Map(
    authorStats.map((u) => [u.id, { ...u._count, lastSeenAt: u.lastSeenAt }]),
  );
  const commentMap = new Map(allComments.map((c) => [c.id, c]));
  const rootIdOf = (c: (typeof allComments)[number]): string => {
    let cur = c;
    while (cur.parentId) {
      const p = commentMap.get(cur.parentId);
      // 祖先楼层已被删除（不在 PUBLIC 集合）→ 上溯链断裂，当前可达的最早祖先视为根
      if (!p) break;
      cur = p;
    }
    return cur.id;
  };
  const replyName = (a: { username: string; name: string | null }) => a.name ?? a.username;
  const repliesByRoot = new Map<
    string,
    {
      c: (typeof allComments)[number];
      replyTo: { id: string; name: string; content: string } | null;
    }[]
  >();
  for (const c of allComments) {
    if (!c.parentId) continue;
    const rootId = rootIdOf(c);
    const list = repliesByRoot.get(rootId) ?? [];
    const parent = commentMap.get(c.parentId);
    // 二级回复 replyTo 为 null；深层回复指向被回复评论（供 UI hover 卡片定位、引用卡显示原文）
    list.push({
      c,
      replyTo: parent?.parentId
        ? { id: parent.id, name: replyName(parent.author), content: parent.content }
        : null,
    });
    repliesByRoot.set(rootId, list);
  }

  // client 组件（Comments）拿到的 avatarKey 必须是已解析 URL：浏览器端 env 不可用
  const toCommentAuthor = (
    a: {
      username: string;
      name: string | null;
      avatarKey: string | null;
      bio: string | null;
      role: string;
      trusted: boolean;
      createdAt: Date;
    },
    id: string,
  ) => {
    const s = statsMap.get(id);
    return {
      username: a.username,
      name: a.name,
      avatarKey: a.avatarKey ? publicUrl(a.avatarKey) : null,
      bio: a.bio,
      role: a.role,
      trusted: a.trusted,
      createdAt: a.createdAt,
      resourceCount: s?.resources,
      followerCount: s?.followers,
      online: isOnline(s?.lastSeenAt),
    };
  };
  const toCommentImages = (
    ms: { storageKey: string; width: number | null; height: number | null }[],
  ) => ms.map((m) => ({ url: publicUrl(m.storageKey), width: m.width, height: m.height }));

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
      avatarKey: resource.author.avatarKey ? publicUrl(resource.author.avatarKey) : null,
      bio: resource.author.bio,
      role: resource.author.role,
      trusted: resource.author.trusted,
      createdAt: resource.author.createdAt,
      resourceCount: resource.author._count.resources,
      followerCount: resource.author._count.followers,
      online: isOnline(resource.author.lastSeenAt),
    },
    comments: allComments
      .filter((c) => !c.parentId)
      .map((c) => ({
        id: c.id,
        authorId: c.authorId,
        content: c.content,
        createdAt: c.createdAt,
        author: toCommentAuthor(c.author, c.authorId),
        images: toCommentImages(c.media),
        replies: (repliesByRoot.get(c.id) ?? []).map(({ c: rp, replyTo }) => ({
          id: rp.id,
          authorId: rp.authorId,
          content: rp.content,
          createdAt: rp.createdAt,
          author: toCommentAuthor(rp.author, rp.authorId),
          replyTo,
        })),
      })),
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

  if (resource.category) {
    const { items } = await getFeed({
      categorySlug: resource.category.slug,
      sort: "popular",
      pageSize: LIMIT * 2,
    });
    push(items);
  }
  if (resource.tags.length > 0) {
    const { items } = await getFeed({
      tagSlugs: resource.tags.map((t) => t.slug),
      sort: "popular",
      pageSize: LIMIT * 2,
    });
    push(items);
  }
  {
    // 同类型热门池兜底（分类/标签池不足时补足多样性）
    const { items } = await getFeed({ type: resource.type, sort: "popular", pageSize: LIMIT * 2 });
    push(items);
  }

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
  type?: ResourceType | "ALL";
  categorySlugs?: string[];
  /** 探索（打破信息茧房）槽位占比 0–0.6，默认 0.3 */
  explorationRatio?: number;
  /** 最终列表最少覆盖的不同分类数，0 = 自动 min(3, count) */
  minCategories?: number;
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
  author: { select: { id: true, username: true, name: true } },
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

export async function getRecommendations(opts: RecommendOpts): Promise<FeedCard[]> {
  const count = Math.max(1, Math.min(48, opts.count ?? 12));
  const personal = !!opts.userId && opts.scope !== "all";

  if (!personal) {
    const { items } = await getFeed({
      type: opts.type,
      sort: "popular",
      pageSize: count,
      categorySlugs: opts.categorySlugs,
    });
    return items.map(toFeedCard);
  }

  const userId = opts.userId!;
  const profile = await buildRecProfile(userId);

  // 无信号 → 回退热门（与游客一致），保证不空白
  if (profile.signalCount === 0) {
    const { items } = await getFeed({
      type: opts.type,
      sort: "popular",
      pageSize: count,
      categorySlugs: opts.categorySlugs,
    });
    return items.map(toFeedCard);
  }

  // 探索占比：弱画像 / 冷启动时更高，主动拓宽视野；强画像按配置收敛到精准
  const cold = profile.signalCount < 3;
  const explorationRatio = Math.min(0.7, clamp(opts.explorationRatio ?? 0.3, 0, 0.6) * (cold ? 1.4 : 1));
  const minCategories = opts.minCategories && opts.minCategories > 0 ? opts.minCategories : 0;

  // 候选池：质量池（已被验证的好内容）+ 新鲜池（近 180 天新内容）合并去重，
  // 兼顾经典与新鲜，从根源降低「只看老内容」的茧房倾向。
  const where: Prisma.ResourceWhereInput = {
    status: "PUBLISHED",
    authorId: { not: userId },
    id: profile.engagedIds.length ? { notIn: profile.engagedIds } : undefined,
  };
  if (opts.type && opts.type !== "ALL") where.type = opts.type;
  if (opts.categorySlugs && opts.categorySlugs.length > 0)
    where.category = { slug: { in: opts.categorySlugs } };

  const recentCut = new Date(Date.now() - 180 * DAY);
  const [quality, fresh] = await Promise.all([
    prisma.resource.findMany({
      where,
      orderBy: [{ likeCount: "desc" }, { publishedAt: "desc" }],
      take: 250,
      select: recSelect,
    }),
    prisma.resource.findMany({
      where: { ...where, publishedAt: { gte: recentCut } },
      orderBy: [{ publishedAt: "desc" }, { likeCount: "desc" }],
      take: 250,
      select: recSelect,
    }),
  ]);
  const poolMap = new Map<string, RecRow>();
  for (const r of quality) poolMap.set(r.id, r);
  for (const r of fresh) poolMap.set(r.id, r);
  if (poolMap.size === 0) {
    const { items } = await getFeed({
      type: opts.type,
      sort: "popular",
      pageSize: count,
      categorySlugs: opts.categorySlugs,
    });
    return items.map(toFeedCard);
  }

  const candidates = [...poolMap.values()].map(toRecItem);
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
        role: true,
        trusted: true,
        createdAt: true,
        lastSeenAt: true,
        showFavorites: true,
        showFollowers: true,
        showFollowing: true,
        emailNotifyComment: true,
        emailNotifyModeration: true,
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
      owner: { select: { id: true, username: true, name: true } },
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
  resource: { slug: string; title: string } | null;
  actor: { username: string; name: string | null } | null;
  commentId: string | null;
};

export async function getNotifications(
  userId: string,
  filter?: "LIKE" | "COMMENT" | "FOLLOW" | "SYSTEM",
): Promise<{ rows: NotificationRow[]; unread: number }> {
  // 「系统」筛选含 MODERATION + SYSTEM 两类
  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(filter === "SYSTEM"
      ? { type: { in: ["MODERATION", "SYSTEM"] } }
      : filter
        ? { type: filter }
        : {}),
  };
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        readAt: true,
        createdAt: true,
        message: true,
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
      resource: r.resourceId ? (resMap.get(r.resourceId) ?? null) : null,
      actor: r.actorId ? (actorMap.get(r.actorId) ?? null) : null,
      commentId: r.commentId,
    })),
    unread,
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
      author: { select: { username: true, name: true, avatarKey: true, lastSeenAt: true } },
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
