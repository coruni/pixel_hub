"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import sharp from "sharp";
import { makeKey, saveFile } from "@/lib/storage";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { parseMeta, metaHasDownload } from "@/lib/meta";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { notifyByEmail } from "@/lib/mail-notify";
import { audit } from "@/lib/actions/_guards";
import { MIB } from "@/lib/upload-config";
import { getUploadLimits } from "@/lib/upload-limits";

async function requiredUser() {
  const s = await auth();
  const u = s?.user;
  if (!u?.id) return null;
  // 防 seed 重跑/删号后旧 session 触发外键错误：写操作前确认账号仍存在且未封禁
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { bannedAt: true } });
  if (!row || row.bannedAt) return null;
  return u;
}

async function notify(
  userId: string,
  actorId: string,
  type: "LIKE" | "COMMENT" | "FOLLOW",
  resourceId?: string,
  commentId?: string,
  message?: string,
) {
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

  // 评论邮件提醒（点赞/关注仅站内，避免骚扰）；after() 在响应后执行，不丢任务也不拖慢 action
  if (type === "COMMENT" && resourceId) {
    after(async () => {
      const [resource, actor] = await Promise.all([
        prisma.resource.findUnique({
          where: { id: resourceId },
          select: { slug: true, title: true },
        }),
        prisma.user.findUnique({ where: { id: actorId }, select: { name: true, username: true } }),
      ]);
      if (!resource || !actor) return;
      await notifyByEmail(
        userId,
        `${actor.name ?? actor.username} 评论了你的内容`,
        `${actor.name ?? actor.username} 在《${resource.title}》下发表了新评论，快去看看吧。`,
        `/resources/${resource.slug}#comment-${commentId ?? "comments"}`,
      );
    });
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

  // 切换 + 计数同事务：不会出现点赞记录与 likeCount 脱节
  try {
    const liked = await prisma.$transaction(async (tx) => {
      const existing = await tx.like.findUnique({
        where: { userId_resourceId: { userId: user.id, resourceId } },
        select: { id: true },
      });
      if (existing) {
        await tx.like.delete({ where: { id: existing.id } });
        await tx.resource.update({
          where: { id: resourceId },
          data: { likeCount: { decrement: 1 } },
        });
        return false;
      }
      await tx.like.create({ data: { userId: user.id, resourceId } });
      await tx.resource.update({
        where: { id: resourceId },
        data: { likeCount: { increment: 1 } },
      });
      return true;
    });
    if (liked) await notify(resource.authorId, user.id, "LIKE", resourceId);
    return { liked };
  } catch (e) {
    // 并发双击：唯一键冲突 → 已是点赞态，幂等返回
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { liked: true };
    throw e;
  }
}

// ---------- 收藏 ----------
// 收藏时若用户还没有「默认收藏」夹子则自动创建，新收藏一律落入其中
async function ensureDefaultCollection(userId: string): Promise<string> {
  // upsert 依赖 Collection @@unique([ownerId, name])：并发首次收藏不会创建出两个默认夹
  const col = await prisma.collection.upsert({
    where: { ownerId_name: { ownerId: userId, name: "默认收藏" } },
    update: {},
    create: { ownerId: userId, name: "默认收藏" },
  });
  return col.id;
}

export async function toggleFavoriteAction(resourceId: string): Promise<{ favorited: boolean }> {
  const user = await requiredUser();
  if (!user) return { favorited: false };
  // 与 toggleLikeAction 一致：只能收藏已上架资源（防操纵未发布/已下架内容计数）
  const target = await prisma.resource.findFirst({
    where: { id: resourceId, status: "PUBLISHED" },
    select: { id: true },
  });
  if (!target) return { favorited: false };
  try {
    const favorited = await prisma.$transaction(async (tx) => {
      const existing = await tx.favorite.findUnique({
        where: { userId_resourceId: { userId: user.id, resourceId } },
        select: { id: true },
      });
      if (existing) {
        await tx.favorite.delete({ where: { id: existing.id } });
        await tx.resource.update({
          where: { id: resourceId },
          data: { favoriteCount: { decrement: 1 } },
        });
        return false;
      }
      const collectionId = await ensureDefaultCollection(user.id);
      await tx.favorite.create({ data: { userId: user.id, resourceId, collectionId } });
      await tx.resource.update({
        where: { id: resourceId },
        data: { favoriteCount: { increment: 1 } },
      });
      return true;
    });
    return { favorited };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { favorited: true };
    throw e;
  }
}

/** 把已收藏的资源移动到指定夹子（collectionId 为空 = 未分组） */
export async function setFavoriteCollectionAction(
  resourceId: string,
  collectionId: string | null,
): Promise<{ ok: boolean }> {
  const user = await requiredUser();
  if (!user) return { ok: false };
  if (collectionId) {
    const c = await prisma.collection.findFirst({
      where: { id: collectionId, ownerId: user.id },
      select: { id: true },
    });
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
  const name = String(fd.get("name") ?? "")
    .trim()
    .slice(0, 30);
  if (!user || !name) return;
  const count = await prisma.collection.count({ where: { ownerId: user.id } });
  if (count >= 20) return; // 上限防滥用
  await prisma.collection.create({ data: { ownerId: user.id, name } });
  revalidatePath(`/u/${user.username}`);
}

export async function renameCollectionAction(fd: FormData): Promise<void> {
  const user = await requiredUser();
  const id = String(fd.get("id") ?? "");
  const name = String(fd.get("name") ?? "")
    .trim()
    .slice(0, 30);
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
  // 关注切换会触发通知：限流防高频骚扰
  if (!rateLimit(`follow:${user.id}`, 20, 60_000)) return { following: false };
  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: user.id, followingId: targetUserId } },
    select: { followerId: true },
  });
  if (existing) {
    await prisma.follow.delete({
      where: { followerId_followingId: { followerId: user.id, followingId: targetUserId } },
    });
    return { following: false };
  }
  try {
    await prisma.follow.create({ data: { followerId: user.id, followingId: targetUserId } });
  } catch (e) {
    // 并发双击：唯一键冲突 → 已是关注态，幂等返回
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { following: true };
    throw e;
  }
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

// 评论附图：压缩为单张 webp（最长边 ≤1200）；张数上限与单张字节上限均取后台 /admin/uploads 配置

function sniffImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  const s = (str: string, off: number) =>
    buf.subarray(off, off + str.length).toString("latin1") === str;
  if (s("RIFF", 0) && s("WEBP", 8)) return true;
  if (s("GIF8", 0)) return true;
  return false;
}

async function saveCommentImage(
  file: File,
  maxBytes: number,
): Promise<{ key: string; width: number; height: number; size: number } | null> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > maxBytes)
    throw new Error(`单张图片不能超过 ${Math.round(maxBytes / MIB)}MB`);
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

export async function addCommentAction(
  _prev: CommentActionState,
  fd: FormData,
): Promise<CommentActionState> {
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

  // 附图（仅主楼，回复不带图）：先落盘，成功与否不阻断文字评论
  const images = fd.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  // 后台配置优先：张数上限（0 = 禁止附图，parseUploadLimits 已 clamp 0..20）与单张字节上限
  const L = await getUploadLimits();
  const commentMaxCount = L.commentImageMaxCount;
  if (images.length > commentMaxCount)
    return { error: `附图最多 ${commentMaxCount} 张` };
  const commentMaxBytes = L.commentImageMaxMb * MIB;
  let saved: { key: string; width: number; height: number; size: number }[] = [];
  if (images.length > 0) {
    // Chevereto 上传接口一次请求仅接受单个文件：每张图各自走一次独立上传请求，
    // 用 Promise 并行发出多个「单文件」请求并逐个收集成败，互不阻断。
    const pics = images.slice(0, commentMaxCount);
    const settled = await Promise.allSettled(
      pics.map((f) => saveCommentImage(f, commentMaxBytes)),
    );
    saved = settled
      .filter(
        (r): r is PromiseFulfilledResult<{ key: string; width: number; height: number; size: number }> =>
          r.status === "fulfilled" && !!r.value,
      )
      .map((r) => r.value);
    for (let i = 0; i < settled.length; i += 1) {
      const r = settled[i]!;
      if (r.status === "rejected") {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.error(`[comment-image] 失败 fileName=${pics[i]?.name ?? "?"}`, reason, r.reason);
      }
    }
  }

  // 评论 + 附图记录 + 计数同事务
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.comment.create({
      data: {
        resourceId: resource.id,
        authorId: user.id,
        parentId: parsed.data.parentId,
        content: parsed.data.content,
      },
    });
    if (saved.length > 0) {
      await tx.media.createMany({
        data: saved.map((m, i) => ({
          kind: "ATTACHMENT" as const,
          commentId: c.id,
          uploaderId: user.id,
          storageKey: m.key,
          width: m.width,
          height: m.height,
          size: m.size,
          mime: "image/webp",
          status: "READY" as const,
          sort: i,
        })),
      });
    }
    await tx.resource.update({
      where: { id: resource.id },
      data: { commentCount: { increment: 1 } },
    });
    return c;
  });

  await notify(resource.authorId, user.id, "COMMENT", resource.id, comment.id);
  return { ok: true };
}

export async function deleteCommentAction(commentId: string): Promise<{ ok: boolean }> {
  const user = await requiredUser();
  if (!user) return { ok: false };
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: { resource: { select: { authorId: true } } },
  });
  if (!comment) return { ok: false };
  const isStaff = user.role === "ADMIN" || user.role === "MODERATOR";
  if (comment.authorId !== user.id && !isStaff && comment.resource.authorId !== user.id)
    return { ok: false };
  // 条件更新 + 计数扣减同事务：只有原本公开的评论被删除才扣；重复删除/非公开评论不重复扣
  const deleted = await prisma.$transaction(async (tx) => {
    const upd = await tx.comment.updateMany({
      where: { id: commentId, status: "PUBLIC" },
      data: { status: "DELETED", content: "" },
    });
    if (upd.count > 0) {
      await tx.resource.update({
        where: { id: comment.resourceId },
        data: { commentCount: { decrement: 1 } },
      });
      return true;
    }
    return false;
  });
  // 非作者删除（版主/资源作者介入治理）落审计
  if (deleted && comment.authorId !== user.id) {
    await audit(user.id, "DELETE_COMMENT", "COMMENT", commentId, `by ${user.role}`);
  }
  return { ok: true };
}

// ---------- 下载计数（会话去重） ----------
export async function incrementDownloadAction(resourceId: string): Promise<{ ok: boolean }> {
  // 下载源：GAME 走 externalUrl；IMAGE/ARTICLE 走 meta（download / downloads）
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, type: true, externalUrl: true, meta: true },
  });
  if (!resource) return { ok: false };
  const hasDl =
    !!resource.externalUrl ||
    metaHasDownload(parseMeta(resource.type as "GAME" | "IMAGE" | "ARTICLE", resource.meta));
  if (!hasDl) return { ok: false };
  // 内存限流兜底 cookie 伪造：每 IP 60 次 / 分钟，超限静默不计数（下载本身不受影响）
  if (!rateLimit(`dl:${clientIp(await headers())}`, 60, 60_000)) return { ok: true };
  const ck = await cookies();
  const marker = ck.get("dl_done")?.value ?? "";
  if (!marker.includes(resourceId)) {
    await prisma.resource.update({
      where: { id: resourceId },
      data: { downloadCount: { increment: 1 } },
    });
    ck.set("dl_done", `${marker},${resourceId}`.slice(0, 1024), {
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  return { ok: true };
}
