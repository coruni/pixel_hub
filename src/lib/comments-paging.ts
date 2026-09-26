import { prisma } from "@/lib/db/prisma";
import { isOnline } from "@/lib/online";
import { publicUrl } from "@/lib/storage";
import type { Prisma } from "@prisma/client";
import {
  REPLIES_PAGE_SIZE,
  ROOT_PAGE_SIZE,
  type CommentAuthor,
  type CommentImage,
  type CommentReply,
  type CommentShape,
  type PagingMeta,
} from "@/components/social/comment-types";

/**
 * 评论区取数：根楼层分页 + 每个根的下挂回复分页。
 *
 * `Comment.rootId`（根楼层 id，根自己指向自己，见 prisma/migrations/0016_comment_root_id.sql）
 * 让「某根的全部后代」变成一条 `WHERE rootId = ?` 的等值查询，取代原先逐层 BFS 的 N 次往返。
 *
 * 迁移尚未执行的库上 rootId 全为 null，此时自动回退到 BFS（下方 fetchRepliesByRootBfs），
 * 保证代码先于迁移上线也不出错。回退分支是临时的，迁移跑完即可删除。
 */

/** 展平回退路径的层数上限：正常评论树远浅于此，纯粹是脏 parentId 成环时的兜底 */
const MAX_REPLY_DEPTH = 20;

const AUTHOR_SELECT = {
  username: true,
  name: true,
  // 昵称特效色：评论是昵称最密集的展示场景，装饰价值最高的一处
  nameColor: true,
  avatarKey: true,
  bio: true,
  role: true,
  trusted: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const COMMENT_INCLUDE = {
  author: { select: AUTHOR_SELECT },
  media: {
    orderBy: { sort: "asc" },
    select: { storageKey: true, width: true, height: true },
  },
} satisfies Prisma.CommentInclude;

type CommentRow = Prisma.CommentGetPayload<{ include: typeof COMMENT_INCLUDE }>;

/** 展平过程中的一个回复节点：parent 是链路上一级，用于还原「回复 @xx」 */
type ReplyNode = { row: CommentRow; parent: CommentRow; rootId: string };

/** 逐层下行的工作项：知道自己属于哪个根，以及上一级是谁 */
type FrontierItem = { row: CommentRow; rootId: string };

export type RootCommentsPage = {
  roots: CommentShape[];
  /** 根楼层的分页状态：total = 根楼层总数（不含楼中楼） */
  paging: PagingMeta;
  /** 公开评论总数（含楼中楼），用于标题「评论（N）」 */
  commentTotal: number;
};

export type RepliesPage = {
  rootId: string;
  replies: CommentReply[];
  /** total = 该根楼层下的回复总数 */
  paging: PagingMeta;
};

/**
 * 根楼层判定：无父，或父已不在公开态（被删 / 被隐藏）。
 *
 * 后半个分支是「回复上移」的口径——父楼层被删后它不再属于任何根的 replies，
 * 必须自己升为根楼层，否则整条回复连同它的子回复会在评论区凭空消失（库里仍是 PUBLIC）。
 * 它必须与 fetchRepliesByRoot 保持同一口径：那里只跟随 PUBLIC 节点，
 * 非公开楼层就地断链，其子回复正好由这里接住。
 */
function rootFloorWhere(resourceId: string): Prisma.CommentWhereInput {
  return {
    resourceId,
    status: "PUBLIC",
    OR: [{ parentId: null }, { parent: { status: { not: "PUBLIC" } } }],
  };
}

function normalizePage(page: number): number {
  return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
}

/** 跨层展平后按时间正序（BFS 只保证层内有序，层间需要重排） */
function byCreatedAsc(a: ReplyNode, b: ReplyNode): number {
  const ta = new Date(a.row.createdAt).getTime();
  const tb = new Date(b.row.createdAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
}

/**
 * 取这些根楼层下的全部公开回复。
 *
 * 只跟随 PUBLIC 节点：非公开的中间楼层不展开，它的子回复按 rootFloorWhere 的口径
 * 会自成根楼层、出现在别的页里，在这里补挂反而会重复展示。
 *
 * 首选 rootId 等值查询（1 次往返）。**必须**同时排除「非公开中间楼层的后代」：
 * 那些行的 rootId 仍指向同一棵拓扑树（rootId 不随删除变化），但按可见口径它们自成根。
 * `NOT: { parent: { status: not PUBLIC } }` 恰好切断这些行 —— 上溯链上只要有一级父非公开，
 * 它的直接子行就命中该条件被排除，再往下的后代也就整支不进入结果集。
 *
 * 迁移未回填 rootId 的库上（rootId 全为 null）上面取不到行，此时回退到 BFS，
 * 保证代码先于迁移上线也能正常工作。
 */
async function fetchRepliesByRoot(roots: CommentRow[]): Promise<Map<string, ReplyNode[]>> {
  const out = new Map<string, ReplyNode[]>();
  if (roots.length === 0) return out;

  const ids = roots.map((r) => r.id);
  const rows = await prisma.comment.findMany({
    where: {
      rootId: { in: ids },
      status: "PUBLIC",
      // 根自己不算「回复」
      id: { notIn: ids },
      // 断链：父楼层不可见 → 本行按可见口径自成根，不该挂在这棵树下面
      NOT: { parent: { status: { not: "PUBLIC" } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: COMMENT_INCLUDE,
  });
  if (rows.length > 0) {
    const byId = new Map(roots.map((r) => [r.id, r]));
    for (const row of rows) {
      const rootId = row.rootId as string;
      const parent = row.parentId ? byId.get(row.parentId) : undefined;
      // 父可能不在本页（跨页的深层回复）：这时只能给一个占位 parent，但 replyTo 需要原文。
      // 分页后每个根的第一个展示页只可能挂到根本身或更浅的回复，而这里已把该根的全量后代取出，
      // 所以父只要还在同一棵树就一定在 rows 里 —— 用两遍扫描补全引用。
      const list = out.get(rootId) ?? [];
      list.push({ row, parent: parent ?? row, rootId });
      out.set(rootId, list);
    }
    // 第二遍：把占位 parent 换成真正的父行（保证 replyTo 的 name/content 是真原文）
    const rowById = new Map(rows.map((r) => [r.id, r]));
    for (const list of out.values()) {
      for (const node of list) {
        if (node.parent !== node.row) continue;
        const real = node.row.parentId ? rowById.get(node.row.parentId) : undefined;
        if (real) node.parent = real;
      }
    }
    for (const list of out.values()) list.sort(byCreatedAsc);
    return out;
  }

  return fetchRepliesByRootBfs(roots);
}

/**
 * 回退实现：逐层 BFS 取回复（每层一次往返）。
 *
 * 仅用于 rootId 尚未回填的库（迁移 0016 执行前）。迁移完成后可以整体删除本函数
 * 与 MAX_REPLY_DEPTH / FrontierItem。
 */
async function fetchRepliesByRootBfs(roots: CommentRow[]): Promise<Map<string, ReplyNode[]>> {
  const out = new Map<string, ReplyNode[]>();
  let frontier: FrontierItem[] = roots.map((row) => ({ row, rootId: row.id }));

  for (let depth = 0; depth < MAX_REPLY_DEPTH && frontier.length > 0; depth++) {
    const byId = new Map(frontier.map((f) => [f.row.id, f]));
    const batch = await prisma.comment.findMany({
      where: { parentId: { in: [...byId.keys()] }, status: "PUBLIC" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: COMMENT_INCLUDE,
    });
    if (batch.length === 0) break;

    const next: FrontierItem[] = [];
    for (const row of batch) {
      const owner = row.parentId ? byId.get(row.parentId) : undefined;
      // 父不在本层（并发新增 / 跨页的根）→ 跳过，交给它自己那页的 BFS 接住
      if (!owner) continue;
      const node: ReplyNode = { row, parent: owner.row, rootId: owner.rootId };
      const list = out.get(node.rootId) ?? [];
      list.push(node);
      out.set(node.rootId, list);
      next.push({ row, rootId: owner.rootId });
    }
    frontier = next;
  }

  for (const list of out.values()) list.sort(byCreatedAsc);
  return out;
}

type AuthorStats = Map<string, { resources: number; followers: number; lastSeenAt: Date | null }>;

/** 用户 hover 卡片统计（作品数/关注者数）+ 在线状态，authorId 批量查一次 */
async function loadAuthorStats(authorIds: string[]): Promise<AuthorStats> {
  const ids = [...new Set(authorIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      lastSeenAt: true,
      _count: { select: { resources: true, followers: true } },
    },
  });
  return new Map(
    rows.map((u) => [
      u.id,
      { resources: u._count.resources, followers: u._count.followers, lastSeenAt: u.lastSeenAt },
    ]),
  );
}

// client 组件（Comments）拿到的 avatarKey 必须是已解析 URL：浏览器端 env 不可用
function toAuthor(row: CommentRow, stats: AuthorStats): CommentAuthor {
  const s = stats.get(row.authorId);
  return {
    id: row.authorId,
    username: row.author.username,
    name: row.author.name,
    avatarKey: row.author.avatarKey ? publicUrl(row.author.avatarKey) : null,
    bio: row.author.bio,
    role: row.author.role,
    trusted: row.author.trusted,
    // UserHoverCard 读的是 joinedAt（不是 createdAt），写错会让「加入于」一直空着
    joinedAt: row.author.createdAt,
    resourceCount: s?.resources,
    followerCount: s?.followers,
    online: isOnline(s?.lastSeenAt),
  };
}

function toImages(row: CommentRow): CommentImage[] {
  return row.media.map((m) => ({
    url: publicUrl(m.storageKey),
    width: m.width,
    height: m.height,
  }));
}

/** 二级回复 replyTo 为 null；深层回复指向被回复评论（供 hover 卡片定位、引用卡显示原文） */
function toReply(node: ReplyNode, stats: AuthorStats): CommentReply {
  const { row, parent } = node;
  return {
    id: row.id,
    authorId: row.authorId,
    content: row.content,
    createdAt: row.createdAt,
    author: toAuthor(row, stats),
    replyTo: parent.parentId
      ? {
          id: parent.id,
          name: parent.author.name ?? parent.author.username,
          content: parent.content,
        }
      : null,
  };
}

function toRootShape(row: CommentRow, allReplies: ReplyNode[], stats: AuthorStats): CommentShape {
  const total = allReplies.length;
  return {
    id: row.id,
    authorId: row.authorId,
    content: row.content,
    createdAt: row.createdAt,
    author: toAuthor(row, stats),
    images: toImages(row),
    replies: allReplies.slice(0, REPLIES_PAGE_SIZE).map((n) => toReply(n, stats)),
    repliesPaging: {
      page: 1,
      total,
      pageSize: REPLIES_PAGE_SIZE,
      hasMore: total > REPLIES_PAGE_SIZE,
    },
  };
}

/** 根楼层第 page 页（按 createdAt 倒序，最新在前），每个根附带第 1 页回复 */
export async function fetchRootCommentsPage(
  resourceId: string,
  page: number,
): Promise<RootCommentsPage> {
  const safePage = normalizePage(page);
  const where = rootFloorWhere(resourceId);
  const [rows, rootTotal, commentTotal] = await Promise.all([
    prisma.comment.findMany({
      where,
      // createdAt 同秒的记录顺序不保证，用 id 兜底保证翻页不重不漏
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (safePage - 1) * ROOT_PAGE_SIZE,
      // 多取一条判断 hasMore，省掉一次 count 分页
      take: ROOT_PAGE_SIZE + 1,
      include: COMMENT_INCLUDE,
    }),
    prisma.comment.count({ where }),
    prisma.comment.count({ where: { resourceId, status: "PUBLIC" } }),
  ]);

  const hasMore = rows.length > ROOT_PAGE_SIZE;
  const roots = hasMore ? rows.slice(0, ROOT_PAGE_SIZE) : rows;
  const repliesByRoot = await fetchRepliesByRoot(roots);

  const authorIds: string[] = roots.map((r) => r.authorId);
  for (const list of repliesByRoot.values()) for (const n of list) authorIds.push(n.row.authorId);
  const stats = await loadAuthorStats(authorIds);

  return {
    roots: roots.map((row) => toRootShape(row, repliesByRoot.get(row.id) ?? [], stats)),
    paging: { page: safePage, total: rootTotal, pageSize: ROOT_PAGE_SIZE, hasMore },
    commentTotal,
  };
}

/** 某个根楼层的回复第 page 页；根不存在或已非公开时返回 null */
export async function fetchRepliesPage(rootId: string, page: number): Promise<RepliesPage | null> {
  const root = await prisma.comment.findFirst({
    where: { id: rootId, status: "PUBLIC" },
    include: COMMENT_INCLUDE,
  });
  if (!root) return null;

  const safePage = normalizePage(page);
  // 该根的全量后代一次取回后在内存切片。
  // 为什么不做 SQL 层的分页：回复是按 createdAt 跨层正序排的（子回复可能晚于更深层的回复），
  // 顺序只有展平后才知道，SQL 里表达不了；且单根回复量天然有限（UI 也按 5 条一页展示）。
  const byRoot = await fetchRepliesByRoot([root]);
  const all = byRoot.get(rootId) ?? [];
  const total = all.length;
  const start = (safePage - 1) * REPLIES_PAGE_SIZE;
  const slice = all.slice(start, start + REPLIES_PAGE_SIZE);

  // 深层回复的 replyTo 会读 parent.author（上移根作为 parent 时），作者统计要一并带上
  const authorIds: string[] = [];
  for (const n of slice) {
    authorIds.push(n.row.authorId);
    if (n.parent.parentId) authorIds.push(n.parent.authorId);
  }
  const stats = await loadAuthorStats(authorIds);

  return {
    rootId,
    replies: slice.map((n) => toReply(n, stats)),
    paging: {
      page: safePage,
      total,
      pageSize: REPLIES_PAGE_SIZE,
      hasMore: start + REPLIES_PAGE_SIZE < total,
    },
  };
}
