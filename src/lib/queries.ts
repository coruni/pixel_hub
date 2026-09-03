import { publicUrl } from "@/lib/storage";
import { prisma } from "@/lib/db/prisma";
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
  category: { slug: string; name: string } | null;
  tags: { slug: string; name: string }[];
  author: { username: string; name: string | null };
  cover: { url: string; width: number | null; height: number | null; placeholder: string | null } | null;
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
  category: { slug: string; name: string } | null;
  author: { username: string; name: string | null };
  cover: { url: string; width: number | null; height: number | null; placeholder: string | null } | null;
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
};

const coverSelect = {
  thumbKey: true,
  bigKey: true,
  storageKey: true,
  placeholder: true,
  width: true,
  height: true,
} as const;

function coverUrl(m: { thumbKey: string | null; bigKey: string | null; storageKey: string }): string {
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

export async function getFeed(params: FeedParams): Promise<{ items: FeedItem[]; page: number; hasMore: boolean }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(48, params.pageSize ?? 24);

  const where: Prisma.ResourceWhereInput = {
    status: params.includeStatuses ? { in: params.includeStatuses } : "PUBLISHED",
  };
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
  if (params.authorUsername) where.author = { username: params.authorUsername };
  if (params.followOnlyOf)
    where.authorId = { in: (await prisma.follow.findMany({ where: { followerId: params.followOnlyOf }, select: { followingId: true } })).map((f) => f.followingId) };
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

  const orderBy: Prisma.ResourceOrderByWithRelationInput[] =
    params.sort === "popular"
      ? [{ likeCount: "desc" }, { publishedAt: "desc" }]
      : params.sort === "downloads"
        ? [{ downloadCount: "desc" }, { publishedAt: "desc" }]
        : [{ publishedAt: "desc" }];

  const rows = await prisma.resource.findMany({
    where,
    orderBy,
    take: pageSize + 1,
    skip: (page - 1) * pageSize,
    include: {
      coverMedia: { select: coverSelect },
      author: { select: { username: true, name: true } },
      category: { select: { slug: true, name: true } },
      tags: { select: { tag: { select: { slug: true, name: true } } }, orderBy: { resourceId: "asc" } },
    },
  });
  const hasMore = rows.length > pageSize;
  return { items: rows.slice(0, pageSize).map(toFeedItem), page, hasMore };
}

export async function getCategories() {
  return prisma.category.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }] });
}

export async function getTopTags(limit = 24) {
  return prisma.tag.findMany({ orderBy: { count: "desc" }, take: limit, select: { slug: true, name: true, count: true } });
}

export type ResourceDetail = Awaited<ReturnType<typeof getResourceDetail>>;

export async function getResourceDetail(slug: string, viewerId?: string) {
  const where: Prisma.ResourceWhereInput = { slug };
  if (!viewerId) where.status = "PUBLISHED";

  const resource = await prisma.resource.findFirst({
    where,
    include: {
      author: { select: { id: true, username: true, name: true, avatarKey: true, bio: true } },
      category: { select: { slug: true, name: true } },
      tags: { select: { tag: { select: { slug: true, name: true } } } },
      media: {
        where: { resourceId: { not: null } },
        orderBy: { sort: "asc" },
        select: { id: true, thumbKey: true, bigKey: true, storageKey: true, width: true, height: true, placeholder: true },
      },
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

  let viewerStates = { liked: false, favorited: false, followingAuthor: false };
  if (viewerId) {
    const [lk, fv, fl] = await Promise.all([
      prisma.like.findUnique({ where: { userId_resourceId: { userId: viewerId, resourceId: resource.id } } }),
      prisma.favorite.findUnique({ where: { userId_resourceId: { userId: viewerId, resourceId: resource.id } } }),
      prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: viewerId, followingId: resource.authorId } },
      }),
    ]);
    viewerStates = { liked: !!lk, favorited: !!fv, followingAuthor: !!fl };
  }

  const comments = await prisma.comment.findMany({
    where: { resourceId: resource.id, status: "PUBLIC", parentId: null },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { username: true, name: true } },
      replies: {
        where: { status: "PUBLIC" },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { username: true, name: true } } },
      },
    },
  });

  return {
    ...resource,
    gallery,
    comments: comments.map((c) => ({
      id: c.id,
      authorId: c.authorId,
      content: c.content,
      createdAt: c.createdAt,
      author: c.author,
      replies: c.replies.map((rp) => ({
        id: rp.id,
        authorId: rp.authorId,
        content: rp.content,
        createdAt: rp.createdAt,
        author: rp.author,
      })),
    })),
    viewer: viewerStates,
  };
}

// 浏览计数（会话内去重由调用方限制）
export async function bumpView(resourceId: string) {
  await prisma.resource.update({ where: { id: resourceId }, data: { viewCount: { increment: 1 } } });
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
};

export async function getProfile(username: string, viewerId?: string): Promise<UserProfile | null> {
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
      _count: { select: { resources: true, followers: true, following: true } },
    },
  });
  if (!user) return null;
  const isViewer = viewerId === user.id;
  let following = false;
  if (viewerId && !isViewer) {
    following = !!(await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: viewerId, followingId: user.id } },
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
  };
}

// ---------- 通知 ----------
export type NotificationRow = {
  id: string;
  type: string;
  readAt: Date | null;
  createdAt: Date;
  message: string | null;
  resource: { slug: string; title: string } | null;
  actor: { username: string; name: string | null } | null;
};

export async function getNotifications(userId: string): Promise<{ rows: NotificationRow[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
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
      },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  // Notification 只存 resourceId / actorId 标量（schema 未建 relation），需二次查询补全
  const rids = [...new Set(rows.map((r) => r.resourceId).filter((x): x is string => !!x))];
  const resMap = new Map(
    (rids.length
      ? await prisma.resource.findMany({ where: { id: { in: rids } }, select: { id: true, slug: true, title: true } })
      : []
    ).map((r) => [r.id, r] as const)
  );
  const aIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const actorMap = new Map(
    (aIds.length
      ? await prisma.user.findMany({ where: { id: { in: aIds } }, select: { id: true, username: true, name: true } })
      : []
    ).map((u) => [u.id, u] as const)
  );

  return {
    rows: rows.map((r) => ({
      id: r.id,
      type: r.type,
      readAt: r.readAt,
      createdAt: r.createdAt,
      message: r.message,
      resource: r.resourceId ? (resMap.get(r.resourceId) ?? null) : null,
      actor: r.actorId ? (actorMap.get(r.actorId) ?? null) : null,
    })),
    unread,
  };
}
