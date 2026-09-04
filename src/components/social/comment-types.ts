import type { HoverCardUser } from "@/components/ui/UserHoverCard";

/** 评论作者（喂 UserHoverCard 的用户信息卡） */
export type CommentAuthor = HoverCardUser & {
  username: string;
  name: string | null;
  avatarKey?: string | null;
};

export type CommentImage = { url: string; width: number | null; height: number | null };

/** 评论树形状：根楼层 + 展平的楼中楼回复（二级回复带 replyTo 引用） */
export type CommentShape = {
  id: string;
  authorId: string;
  content: string;
  createdAt: string | Date;
  author: CommentAuthor;
  images?: CommentImage[];
  replies: {
    id: string;
    authorId: string;
    content: string;
    createdAt: string | Date;
    author: CommentAuthor;
    // 展平后深层回复的被回复人（二级回复为 null；content 供引用卡显示被回复原文）
    replyTo?: { id: string; name: string; content: string } | null;
  }[];
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
