"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

async function requiredUser() {
  const s = await auth();
  const u = s?.user;
  if (!u?.id) return null;
  // 防 seed 重跑/删号后旧 session 触发外键错误：写操作前确认账号仍存在且未封禁
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { bannedAt: true } });
  if (!row || row.bannedAt) return null;
  return u;
}

async function notify(userId: string, actorId: string, type: "LIKE" | "COMMENT" | "FOLLOW", resourceId?: string, commentId?: string, message?: string) {
  if (!userId || userId === actorId) return;
  await prisma.notification
    .create({
      data: {
        userId,
        actorId,
        type,
        resourceId,
        commentId,
        message: message ?? null,
      },
    })
    .catch(() => undefined);
}

// ---------- 点赞 ----------
export async function toggleLikeAction(resourceId: string): Promise<{ liked: boolean }> {
  const user = await requiredUser();
  if (!user) return { liked: false };
  const resource = await prisma.resource.findFirst({
    where: { id: resourceId, status: "PUBLISHED" },
    select: { id: true, authorId: true },
  });
  if (!resource) return { liked: false };

  const existing = await prisma.like.findUnique({
    where: { userId_resourceId: { userId: user.id, resourceId } },
  });
  if (existing) {
    await prisma.like.delete({ where: { id: existing.id } });
    await prisma.resource.update({ where: { id: resourceId }, data: { likeCount: { decrement: 1 } } });
    return { liked: false };
  }
  await prisma.like.create({ data: { userId: user.id, resourceId } });
  await prisma.resource.update({ where: { id: resourceId }, data: { likeCount: { increment: 1 } } });
  await notify(resource.authorId, user.id, "LIKE", resourceId);
  return { liked: true };
}

// ---------- 收藏 ----------
export async function toggleFavoriteAction(resourceId: string): Promise<{ favorited: boolean }> {
  const user = await requiredUser();
  if (!user) return { favorited: false };
  const existing = await prisma.favorite.findUnique({
    where: { userId_resourceId: { userId: user.id, resourceId } },
  });
  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    await prisma.resource.update({ where: { id: resourceId }, data: { favoriteCount: { decrement: 1 } } });
    return { favorited: false };
  }
  await prisma.favorite.create({ data: { userId: user.id, resourceId } });
  await prisma.resource.update({ where: { id: resourceId }, data: { favoriteCount: { increment: 1 } } });
  return { favorited: true };
}

// ---------- 关注 ----------
export async function toggleFollowAction(targetUserId: string): Promise<{ following: boolean }> {
  const user = await requiredUser();
  if (!user || user.id === targetUserId) return { following: false };
  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: user.id, followingId: targetUserId } },
  });
  if (existing) {
    await prisma.follow.delete({
      where: { followerId_followingId: { followerId: user.id, followingId: targetUserId } },
    });
    return { following: false };
  }
  await prisma.follow.create({ data: { followerId: user.id, followingId: targetUserId } });
  await notify(targetUserId, user.id, "FOLLOW");
  return { following: true };
}

// ---------- 评论 ----------
const commentSchema = z.object({
  resourceId: z.string().min(1),
  parentId: z.string().optional(),
  content: z.string().trim().min(1, "评论不能为空").max(2000, "评论过长"),
});
export type CommentActionState = { error?: string; ok?: boolean };

export async function addCommentAction(_prev: CommentActionState, fd: FormData): Promise<CommentActionState> {
  const user = await requiredUser();
  if (!user) return { error: "请先登录后再评论" };
  const parsed = commentSchema.safeParse({
    resourceId: fd.get("resourceId"),
    parentId: fd.get("parentId") || undefined,
    content: fd.get("content"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "评论内容不合法" };

  const resource = await prisma.resource.findFirst({
    where: { id: parsed.data.resourceId, status: "PUBLISHED", allowComments: true },
    select: { id: true, authorId: true },
  });
  if (!resource) return { error: "资源不存在或已关闭评论" };

  if (parsed.data.parentId) {
    const parent = await prisma.comment.findFirst({
      where: { id: parsed.data.parentId, resourceId: resource.id, status: "PUBLIC" },
    });
    if (!parent) return { error: "回复的楼层不存在" };
  }

  const comment = await prisma.comment.create({
    data: {
      resourceId: resource.id,
      authorId: user.id,
      parentId: parsed.data.parentId,
      content: parsed.data.content,
    },
  });
  await prisma.resource.update({ where: { id: resource.id }, data: { commentCount: { increment: 1 } } });
  await notify(resource.authorId, user.id, "COMMENT", resource.id, comment.id);
  return { ok: true };
}

export async function deleteCommentAction(commentId: string): Promise<{ ok: boolean }> {
  const user = await requiredUser();
  if (!user) return { ok: false };
  const comment = await prisma.comment.findUnique({ where: { id: commentId }, include: { resource: { select: { authorId: true } } } });
  if (!comment) return { ok: false };
  const isStaff = user.role === "ADMIN" || user.role === "MODERATOR";
  if (comment.authorId !== user.id && !isStaff && comment.resource.authorId !== user.id) return { ok: false };
  await prisma.comment.update({ where: { id: commentId }, data: { status: "DELETED", content: "" } });
  await prisma.resource.update({ where: { id: comment.resourceId }, data: { commentCount: { decrement: 1 } } });
  return { ok: true };
}

// ---------- 下载计数（会话去重） ----------
export async function incrementDownloadAction(resourceId: string): Promise<{ ok: boolean }> {
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!resource || !resource.externalUrl) return { ok: false };
  const ck = await cookies();
  const marker = ck.get("dl_done")?.value ?? "";
  if (!marker.includes(resourceId)) {
    await prisma.resource.update({ where: { id: resourceId }, data: { downloadCount: { increment: 1 } } });
    ck.set("dl_done", `${marker},${resourceId}`.slice(0, 1024), { path: "/", maxAge: 60 * 60 * 24 });
  }
  return { ok: true };
}
