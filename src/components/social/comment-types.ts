import type { HoverCardUser } from "@/components/ui/UserHoverCard";

/** 评论作者（喂 UserHoverCard 的用户信息卡） */
export type CommentAuthor = HoverCardUser & {
  id?: string;
  username: string;
  name: string | null;
  avatarKey?: string | null;
  /** 昵称特效色 key（见 lib/decorations.ts）；null/缺省 = 站点默认色 */
  nameColor?: string | null;
};

export type CommentImage = { url: string; width: number | null; height: number | null };

/**
 * 分页条数契约。定义放在这里而不是 comments-paging.ts：那边依赖 prisma，
 * 客户端组件（分页器、Comments）不能引用，而总页数需要它来算。
 */
export const ROOT_PAGE_SIZE = 10;
export const REPLIES_PAGE_SIZE = 5;
/** 评论与子评论回复的 Markdown 源码长度上限，与 social.ts 的 schema 同口径。 */
export const COMMENT_MAX = 2000;
export const COMMENT_WARN_AT = 200;

/** 分页状态：page 从 1 开始，total 是该层总数，hasMore 表示后面还有页 */
export type PagingMeta = {
  page: number;
  total: number;
  /** 每页条数一并带过来，客户端算总页数时不必再引一次常量 */
  pageSize: number;
  hasMore: boolean;
};

/** 总页数（至少 1 页），分页器据此渲染「第 X/Y 页」与末页禁用 */
export function totalPagesOf(paging: { total: number; pageSize: number }): number {
  return Math.max(1, Math.ceil(paging.total / Math.max(1, paging.pageSize)));
}

/** 楼中楼回复：二级回复 replyTo 为 null，深层回复指向被回复评论 */
export type CommentReply = {
  id: string;
  authorId: string;
  content: string;
  createdAt: string | Date;
  author: CommentAuthor;
  // 展平后深层回复的被回复人（二级回复为 null；content 供引用卡显示被回复原文）
  replyTo?: { id: string; name: string; content: string } | null;
};

/** 评论树形状：根楼层 + 当前页的展平回复（replyTo 供 UI 显示「回复 @xx」） */
export type CommentShape = {
  id: string;
  authorId: string;
  content: string;
  createdAt: string | Date;
  author: CommentAuthor;
  images?: CommentImage[];
  /** 只是当前页的回复，不是该根的全部；总数与页码见 repliesPaging */
  replies: CommentReply[];
  /** 该根楼层下回复的分页状态 */
  repliesPaging: PagingMeta;
};

/** 评论区（根楼层维度）的分页状态 */
export type CommentsPaging = PagingMeta & {
  /** 含楼中楼的公开评论总数，用于标题「评论（N）」 */
  commentTotal: number;
};

/** 评论增量 API 项（带 parentId，比 CommentShape.replies 多 images/replyTo 可选） */
export type NewCommentItem = {
  id: string;
  parentId: string | null;
  authorId: string;
  content: string;
  createdAt: string | Date;
  author: CommentAuthor;
  images?: CommentImage[];
  replyTo?: { id: string; name: string; content: string } | null;
};
