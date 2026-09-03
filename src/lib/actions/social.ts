"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { makeKey, saveFile } from "@/lib/storage";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { notifyByEmail } from "@/lib/mail-notify";

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

  // 评论邮件提醒（点赞/关注仅站内，避免骚扰）；fire-and-forget，不拖慢 action
  if (type === "COMMENT" && resourceId) {
    void (async () => {
      const [resource, actor] = await Promise.all([
        prisma.resource.findUnique({ where: { id: resourceId }, select: { slug: true, title: true } }),
        prisma.user.findUnique({ where: { id: actorId }, select: { name: true, username: true } }),
      ]);
      if (!resource || !actor) return;
      await notifyByEmail(
        userId,
        `${actor.name ?? actor.username} 评论了你的内容`,
        `${actor.name ?? actor.username} 在《${resource.title}》下发表了新评论，快去看看吧。`,
        `/resources/${resource.slug}#comment-${commentId ?? "comments"}`,
      );
    })();
  }
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
// 收藏时若用户还没有「默认收藏」夹子则自动创建，新收藏一律落入其中
async function ensureDefaultCollection(userId: string): Promise<string> {
  const existing = await prisma.collection.findFirst({
    where: { ownerId: userId, name: "默认收藏" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.collection.create({ data: { ownerId: userId, name: "默认收藏" } });
  return created.id;
}

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
  const collectionId = await ensureDefaultCollection(user.id);
  await prisma.favorite.create({ data: { userId: user.id, resourceId, collectionId } });
  await prisma.resource.update({ where: { id: resourceId }, data: { favoriteCount: { increment: 1 } } });
  return { favorited: true };
}

/** 把已收藏的资源移动到指定夹子（collectionId 为空 = 未分组） */
export async function setFavoriteCollectionAction(
  resourceId: string,
  collectionId: string | null
): Promise<{ ok: boolean }> {
  const user = await requiredUser();
  if (!user) return { ok: false };
  if (collectionId) {
    const c = await prisma.collection.findFirst({ where: { id: collectionId, ownerId: user.id }, select: { id: true } });
    if (!c) return { ok: false };
  }
  await prisma.favorite.updateMany({
    where: { userId: user.id, resourceId },
    data: { collectionId },
  });
  revalidatePath(`/u/${user.username}`);
  return { ok: true };
}

// ---------- 收藏夹 ----------
export async function createCollectionAction(fd: FormData): Promise<void> {
  const user = await requiredUser();
  const name = String(fd.get("name") ?? "").trim().slice(0, 30);
  if (!user || !name) return;
  const count = await prisma.collection.count({ where: { ownerId: user.id } });
  if (count >= 20) return; // 上限防滥用
  await prisma.collection.create({ data: { ownerId: user.id, name } });
  revalidatePath(`/u/${user.username}`);
}

export async function renameCollectionAction(fd: FormData): Promise<void> {
  const user = await requiredUser();
  const id = String(fd.get("id") ?? "");
  const name = String(fd.get("name") ?? "").trim().slice(0, 30);
  if (!user || !id || !name) return;
  await prisma.collection.updateMany({ where: { id, ownerId: user.id }, data: { name } });
  revalidatePath(`/u/${user.username}`);
}

/** 删除夹子：夹内收藏保留（collectionId 置空，归入「未分组」） */
export async function deleteCollectionAction(fd: FormData): Promise<void> {
  const user = await requiredUser();
  const id = String(fd.get("id") ?? "");
  if (!user || !id) return;
  await prisma.collection.deleteMany({ where: { id, ownerId: user.id } });
  revalidatePath(`/u/${user.username}`);
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

// 评论附图：压缩为单张 webp（最长边 ≤1200），≤3 张、各 ≤5MB
const COMMENT_IMG_MAX_BYTES = 5 * 1024 * 1024;
const COMMENT_IMG_MAX_COUNT = 3;

function sniffImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  const s = (str: string, off: number) => buf.subarray(off, off + str.length).toString("latin1") === str;
  if (s("RIFF", 0) && s("WEBP", 8)) return true;
  if (s("GIF8", 0)) return true;
  return false;
}

async function saveCommentImage(file: File): Promise<{ key: string; width: number; height: number; size: number } | null> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > COMMENT_IMG_MAX_BYTES) throw new Error("单张图片不能超过 5MB");
  if (!sniffImage(buf)) throw new Error("不支持的图片格式");
  const out = await sharp(buf, { failOn: "none" })
    .rotate()
    .resize({ width: 1200, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const key = makeKey("comments", ".webp");
  const url = await saveFile(key, out.data);
  return { key: url, width: out.info.width, height: out.info.height, size: out.data.byteLength };
}

export async function addCommentAction(_prev: CommentActionState, fd: FormData): Promise<CommentActionState> {
  const user = await requiredUser();
  if (!user) return { error: "请先登录后再评论" };
  // 评论限流：每用户 10 条 / 分钟（防灌水）
  if (!rateLimit(`comment:${user.id}`, 10, 60_000)) return { error: "评论太快了，休息一下再发" };
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

  // 附图（仅主楼，回复不带图）
  const images = fd.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  if (images.length > COMMENT_IMG_MAX_COUNT) return { error: `附图最多 ${COMMENT_IMG_MAX_COUNT} 张` };

  const comment = await prisma.comment.create({
    data: {
      resourceId: resource.id,
      authorId: user.id,
      parentId: parsed.data.parentId,
      content: parsed.data.content,
    },
  });

  if (images.length > 0) {
    try {
      const saved = await Promise.all(images.slice(0, COMMENT_IMG_MAX_COUNT).map(saveCommentImage));
      await prisma.media.createMany({
        data: saved
          .filter((x): x is { key: string; width: number; height: number; size: number } => !!x)
          .map((m, i) => ({
            kind: "ATTACHMENT" as const,
            commentId: comment.id,
            storageKey: m.key,
            width: m.width,
            height: m.height,
            size: m.size,
            mime: "image/webp",
            status: "READY" as const,
            sort: i,
          })),
      });
    } catch (e) {
      // 图片失败不阻断文字评论
      console.error("[comment-image]", e);
    }
  }

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
