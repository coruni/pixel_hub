import { publicUrl } from "@/lib/storage";
import { prisma } from "@/lib/db/prisma";
import { isOnline } from "@/lib/online";
import { auth } from "@/lib/auth";
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
  if (params.ids && params.ids.length > 0) where.id = { in: params.ids };
  if (params.q) {
    where.OR = [
      { title: { contains: params.q } },
      { summary: { contains: params.q } },
      { description: { contains: params.q } },
      { tags: { some: { tag: { name: { contains: params.q } } } } },
    ];
  }
  if (params.period && params.period !== "all" && params.includeStatuses?.includes("PUBLISHED")) {
    const days = params.period === "day" ? 1 : params.period === "week" ? 7 : 30;
    where.publishedAt = { gte: new Date(Date.now() - days * 24 * 3600 * 1000) };
  } else if (params.period && params.period !== "all") {
    const days = params.period === "day" ? 1 : params.period === "week" ? 7 : 30;
    where.publishedAt = { gte: new Date(Date.now() - days * 24 * 3600 * 1000) };
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
// 同分类热门优先，不足补同类型热门（排除自身与已取条目），复用 getFeed 的取数逻辑
export async function getRelated(resource: {
  id: string;
  type: ResourceType;
  category: { slug: string } | null;
}): Promise<FeedCard[]> {
  const LIMIT = 6;
  const seen = new Set<string>([resource.id]);
  const out: FeedItem[] = [];
  const add = (items: FeedItem[]) => {
    for (const i of items) {
      if (out.length >= LIMIT) break;
      if (!seen.has(i.id)) {
        seen.add(i.id);
        out.push(i);
      }
    }
  };

  if (resource.category) {
    const { items } = await getFeed({
      categorySlug: resource.category.slug,
      sort: "popular",
      pageSize: LIMIT,
    });
    add(items);
  }
  if (out.length < LIMIT) {
    // 同类型热门池取大一点，过滤掉已占位后仍有余量
    const { items } = await getFeed({ type: resource.type, sort: "popular", pageSize: LIMIT * 2 });
    add(items);
  }
  return out.map(toFeedCard);
}

// ---------- 个人主页 ----------
export type UserProfile = {
  id: string;
  username: string;
  name: string | null;
  bio: string | null;
  avatarKey: string | null;
  role: "USER" | "MODERATOR" | "ADMIN";
  trusted: boolean;
  createdAt: Date;
  resourceCount: number;
  followerCount: number;
  followingCount: number;
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
        role: true,
        trusted: true,
        createdAt: true,
        lastSeenAt: true,
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
      role: user.role,
      trusted: user.trusted,
      createdAt: user.createdAt,
      resourceCount: user._count.resources,
      followerCount: user._count.followers,
      followingCount: user._count.following,
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
