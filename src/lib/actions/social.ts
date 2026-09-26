"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import sharp from "sharp";
import { makeKey, saveFile } from "@/lib/storage";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { parseMeta, metaHasDownload } from "@/lib/meta";
import { rateLimit } from "@/lib/rate-limit";
import { hashIp, ipFromHeaders } from "@/lib/ip";
import { recordDownload } from "@/lib/download-record";
import { awardPoints, interactionRefId } from "@/lib/points";
import { notifyByEmail } from "@/lib/mail-notify";
import { createNotification } from "@/lib/notify";
import { publishCommentChanged, publishCommentNew } from "@/lib/realtime/publish";
import { audit } from "@/lib/actions/_guards";
import { MIB } from "@/lib/upload-config";
import { getUploadLimits } from "@/lib/upload-limits";
import { fetchRepliesPage, fetchRootCommentsPage } from "@/lib/comments-paging";
import type { CommentReply, CommentShape, PagingMeta } from "@/components/social/comment-types";
import {
  compressWith,
  compressConfigOf,
  outputExt,
  outputMime,
  type ImageCompressConfig,
} from "@/lib/media/compress";
import { applyWatermark, resolveWatermark, type WatermarkSpec } from "@/lib/media/watermark";

async function requiredUser() {
  const s = await auth();
  const u = s?.user;
  if (!u?.id) return null;
  // 防 seed 重跑/删号后旧 session 触发外键错误：写操作前确认账号仍存在且未封禁
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { bannedAt: true } });
  if (!row || row.bannedAt) return null;
  return u;
}

/** 评论摘要：站内/邮件文案都带一段正文，收件人不用点进去才知道说了什么 */
function excerptOf(s: string, max = 60): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/**
 * 评论 / 回复提醒（站内 + 邮件）。
 * reply=true 表示「回复了你的评论」，false 表示「评论了你的内容」；
 * email 仅在「同一次评论里该收件人还没被邮件通知过」时为 true，避免一次评论炸两封邮件。
 */
async function notifyComment(opts: {
  toUserId: string;
  actorId: string;
  resourceId: string;
  commentId: string;
  excerpt: string;
  reply: boolean;
  email?: boolean;
}): Promise<void> {
  const { toUserId, actorId, resourceId, commentId, excerpt, reply } = opts;
  if (!toUserId || toUserId === actorId) return; // 自己回复自己不提醒

  const action = reply ? "回复了你的评论" : "评论了你的内容";
  await createNotification({
    userId: toUserId,
    actorId,
    type: "COMMENT",
    resourceId,
    commentId,
    message: `${action}：${excerpt}`,
  });

  if (!opts.email) return;
  // 邮件提醒：after() 在响应后执行，不丢任务也不拖慢 action
  after(async () => {
    const [resource, actor] = await Promise.all([
      prisma.resource.findUnique({
        where: { id: resourceId },
        select: { slug: true, title: true },
      }),
      prisma.user.findUnique({ where: { id: actorId }, select: { name: true, username: true } }),
    ]);
    if (!resource || !actor) return;
    const who = actor.name ?? actor.username;
    await notifyByEmail(
      toUserId,
      `${who} ${action}`,
      `${who} ${reply ? `回复了你在《${resource.title}》下的评论` : `在《${resource.title}》下发表了新评论`}：${excerpt}`,
      `/resources/${resource.slug}#comment-${commentId}`,
      "comment",
    );
  });
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
    if (liked) {
      await createNotification({
        userId: resource.authorId,
        actorId: user.id,
        type: "LIKE",
        resourceId,
        coalesce: true, // 取消赞再点不重复提醒；同批多个赞聚合成一条「X 等 N 人」
      });
      // 计分：只有「点上」才加，「取消赞」不回冲（口径=累计获得，见计划 §5）
      after(() =>
        awardPoints({
          userId: resource.authorId,
          actorId: user.id,
          reason: "LIKE_RECEIVED",
          refId: interactionRefId("like", user.id, resourceId),
        }),
      );
    }
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
    select: { id: true, authorId: true },
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
    if (favorited)
      // 计分：取消收藏不回冲；同一人反复收藏同一作品只算一次
      after(() =>
        awardPoints({
          userId: target.authorId,
          actorId: user.id,
          reason: "FAVORITE_RECEIVED",
          refId: interactionRefId("fav", user.id, resourceId),
        }),
      );
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
  if (!(await rateLimit(`follow:${user.id}`, 20, 60_000))) return { following: false };
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
  await createNotification({
    userId: targetUserId,
    actorId: user.id,
    type: "FOLLOW",
    coalesce: true, // 取关后再关注不重复刷屏
  });
  // 计分：取关不回冲；同一人对同一被关注者只算一次（取关再关注不再加）
  after(() =>
    awardPoints({
      userId: targetUserId,
      actorId: user.id,
      reason: "FOLLOWER_GAINED",
      refId: interactionRefId("flw", user.id, targetUserId),
    }),
  );
  return { following: true };
}

// ---------- 评论 ----------
const commentSchema = z.object({
  resourceId: z.string().min(1),
  parentId: z.string().optional(),
  content: z.string().trim().min(1, "评论不能为空").max(2000, "评论过长"),
});
export type CommentActionState = { error?: string; ok?: boolean };

// 评论附图：压缩为单张图片（格式/质量取后台 /admin/uploads 配置，最长边 ≤1200）；
// 张数上限与单张字节上限同样取后台配置

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
  cfg: ImageCompressConfig,
  watermark: WatermarkSpec | null,
): Promise<{ key: string; width: number; height: number; size: number; mime: string } | null> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > maxBytes)
    throw new Error(`单张图片不能超过 ${Math.round(maxBytes / MIB)}MB`);
  if (!sniffImage(buf)) throw new Error("不支持的图片格式");
  // 水印字号按**输出**画幅定：原图可能远大于 1200，得先算 resize 后的尺寸再叠加，
  // 否则水印在大图上会小得离谱（processImage 里同理，那里用的是同一套派生公式）。
  const oriented = sharp(buf, { failOn: "none" }).rotate();
  const meta = await oriented.metadata();
  const outW = meta.width ? Math.min(meta.width, 1200) : 0;
  const outH = meta.width ? Math.round(((meta.height ?? 0) * outW) / meta.width) : 0;
  const out = await compressWith(
    applyWatermark(oriented.resize({ width: 1200, withoutEnlargement: true }), watermark, outW, outH),
    cfg,
  ).toBuffer({ resolveWithObject: true });
  const key = makeKey("comments", `.${outputExt(cfg.format)}`);
  // 显式带上类型：s3 驱动不带 ContentType 时对象会落成 octet-stream，直链访问变下载
  const url = await saveFile(key, out.data, outputMime(cfg.format));
  return {
    key: url,
    width: out.info.width,
    height: out.info.height,
    size: out.data.byteLength,
    mime: outputMime(cfg.format),
  };
}

export async function addCommentAction(
  _prev: CommentActionState,
  fd: FormData,
): Promise<CommentActionState> {
  const user = await requiredUser();
  if (!user) return { error: "请先登录后再评论" };
  // 评论限流：每用户 10 条 / 分钟（防灌水）
  if (!(await rateLimit(`comment:${user.id}`, 10, 60_000))) return { error: "评论太快了，休息一下再发" };
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

  let parentAuthorId: string | null = null;
  if (parsed.data.parentId) {
    const parent = await prisma.comment.findFirst({
      where: { id: parsed.data.parentId, resourceId: resource.id, status: "PUBLIC" },
    });
    if (!parent) return { error: "回复的楼层不存在" };
    parentAuthorId = parent.authorId;
  }

  // 附图（仅主楼，回复不带图）：先落盘，成功与否不阻断文字评论
  const images = fd.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  // 后台配置优先：张数上限（0 = 禁止附图，parseUploadLimits 已 clamp 0..20）与单张字节上限
  const L = await getUploadLimits();
  const commentMaxCount = L.commentImageMaxCount;
  if (images.length > commentMaxCount)
    return { error: `附图最多 ${commentMaxCount} 张` };
  const commentMaxBytes = L.commentImageMaxMb * MIB;
  const compressCfg = compressConfigOf(L);
  // 水印偏好（默认关闭）：与图集上传走同一处判断（resolveWatermark 内含字体环境自检）
  const wmPref =
    images.length > 0
      ? await prisma.user.findUnique({
          where: { id: user.id },
          select: {
            username: true,
            watermarkImages: true,
            watermarkText: true,
            watermarkPosition: true,
          },
        })
      : null;
  const watermark = await resolveWatermark(
    !!wmPref?.watermarkImages,
    wmPref?.username ?? "",
    wmPref?.watermarkText,
    wmPref?.watermarkPosition ?? "BOTTOM_RIGHT",
  );
  let saved: { key: string; width: number; height: number; size: number; mime: string }[] = [];
  if (images.length > 0) {
    // Chevereto 上传接口一次请求仅接受单个文件：每张图各自走一次独立上传请求，
    // 用 Promise 并行发出多个「单文件」请求并逐个收集成败，互不阻断。
    const pics = images.slice(0, commentMaxCount);
    const settled = await Promise.allSettled(
      pics.map((f) => saveCommentImage(f, commentMaxBytes, compressCfg, watermark)),
    );
    saved = settled
      .filter(
        (
          r,
        ): r is PromiseFulfilledResult<{
          key: string;
          width: number;
          height: number;
          size: number;
          mime: string;
        }> => r.status === "fulfilled" && !!r.value,
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
          mime: m.mime,
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

  const excerpt = excerptOf(parsed.data.content);
  if (parentAuthorId && parentAuthorId !== resource.authorId) {
    // 楼中楼：资源作者被回复人不是同一人 → 两人各收一条（作者：有人在我内容下评论；被回复人：有人回复我的评论）
    await notifyComment({
      toUserId: resource.authorId,
      actorId: user.id,
      resourceId: resource.id,
      commentId: comment.id,
      excerpt,
      reply: false,
      email: true,
    });
    await notifyComment({
      toUserId: parentAuthorId,
      actorId: user.id,
      resourceId: resource.id,
      commentId: comment.id,
      excerpt,
      reply: true,
      email: true,
    });
  } else {
    // 顶层评论；或「楼中楼里被回复的人恰好就是资源作者」——文案按回复处理更准确
    await notifyComment({
      toUserId: resource.authorId,
      actorId: user.id,
      resourceId: resource.id,
      commentId: comment.id,
      excerpt,
      reply: !!parentAuthorId,
      email: true,
    });
  }
  // 计分记给资源作者（「收到评论」）；删评不回冲，同一人对同一作品只算一次（防灌水刷分）
  after(() =>
    awardPoints({
      userId: resource.authorId,
      actorId: user.id,
      reason: "COMMENT_RECEIVED",
      refId: interactionRefId("cmt", user.id, resource.id),
    }),
  );
  // 实时推送放在事务提交之后：正文不随推送下发，观看端收到信号后自行拉增量（见 use-comment-polling）
  publishCommentNew(resource.id);
  return { ok: true };
}

// ---------- 评论分页 ----------
// 首屏由 getResourceDetail 直接给出第 1 页；这里只负责翻页，取数口径与首屏完全一致
// （根楼层 createdAt 倒序、每根附带其回复的第 1 页），否则翻页会出现重复或漏行。

const rootCommentsPageSchema = z.object({
  resourceId: z.string().min(1).max(64),
  page: z.number().int().min(1).max(500),
});

export type RootCommentsPageResult =
  | { ok: true; roots: CommentShape[]; paging: PagingMeta; commentTotal: number }
  | { ok: false; error: string };

/** 评论区根楼层翻页：返回该页的根楼层（每个根只带第 1 页回复） */
export async function loadRootCommentsAction(input: {
  resourceId: string;
  page: number;
}): Promise<RootCommentsPageResult> {
  const parsed = rootCommentsPageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "参数不合法" };

  // 与 getResourceDetail 同口径：登录用户可预览未发布资源的评论区，匿名只看已发布
  const session = await auth();
  const viewerId = typeof session?.user?.id === "string" && session.user.id ? session.user.id : null;
  const resource = await prisma.resource.findFirst({
    where: {
      id: parsed.data.resourceId,
      ...(viewerId ? {} : { status: "PUBLISHED" as const }),
    },
    select: { id: true },
  });
  if (!resource) return { ok: false, error: "资源不存在或已下线" };

  const p = await fetchRootCommentsPage(resource.id, parsed.data.page);
  return { ok: true, roots: p.roots, paging: p.paging, commentTotal: p.commentTotal };
}

const repliesPageSchema = z.object({
  rootId: z.string().min(1).max(64),
  page: z.number().int().min(1).max(500),
});

export type RepliesPageResult =
  | { ok: true; replies: CommentReply[]; paging: PagingMeta }
  | { ok: false; error: string };

/** 单个根楼层的子评论翻页 */
export async function loadRepliesAction(input: {
  rootId: string;
  page: number;
}): Promise<RepliesPageResult> {
  const parsed = repliesPageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "参数不合法" };

  const p = await fetchRepliesPage(parsed.data.rootId, parsed.data.page);
  if (!p) return { ok: false, error: "这条评论已不存在" };
  return { ok: true, replies: p.replies, paging: p.paging };
}

/** 删除评论。失败时给可读原因 —— 前台要把它直接 toast 出来，不能只回一个 ok:false。 */
export async function deleteCommentAction(
  commentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requiredUser();
  if (!user) return { ok: false, error: "请先登录再操作" };
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: { resource: { select: { authorId: true } } },
  });
  if (!comment) return { ok: false, error: "这条评论不存在或已被删除" };
  const isStaff = user.role === "ADMIN" || user.role === "MODERATOR";
  if (comment.authorId !== user.id && !isStaff && comment.resource.authorId !== user.id)
    return { ok: false, error: "没有权限删除这条评论" };
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
  // 删除改变了评论树结构（回复会上移成独立评论），增量端点表达不了 → 通知观看端全量刷新
  if (deleted) publishCommentChanged(comment.resourceId);
  return { ok: true };
}

// ---------- 下载计数（主体级去重 + 月度计分配额） ----------
// 去重口径从 cookie 改为「登录 userId / 匿名 ipHash」的主体级唯一键：cookie 一清就白送一次下载量，
// 而下载量是结算分来源，等于把激励池敞开。闸门细节见 src/lib/download-record.ts。
export async function incrementDownloadAction(resourceId: string): Promise<{ ok: boolean }> {
  // 下载源：GAME 走 externalUrl；IMAGE/ARTICLE 走 meta（download / downloads）
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, type: true, externalUrl: true, meta: true, authorId: true, status: true },
  });
  if (!resource) return { ok: false };
  const hasDl =
    !!resource.externalUrl ||
    metaHasDownload(parseMeta(resource.type as "GAME" | "IMAGE" | "ARTICLE", resource.meta));
  if (!hasDl) return { ok: false };

  const ip = ipFromHeaders(await headers());
  // 限流兜底伪造：每 IP 60 次 / 分钟，超限静默不计数（下载本身不受影响）
  if (!(await rateLimit(`dl:${ip}`, 60, 60_000))) return { ok: true };

  const session = await auth();
  const userId =
    typeof session?.user?.id === "string" && session.user.id ? session.user.id : null;
  const rec = await recordDownload({ resourceId, userId, ipHash: hashIp(ip) });

  if (rec.firstTime) {
    await prisma.resource.update({
      where: { id: resourceId },
      data: { downloadCount: { increment: 1 } },
    });
  }
  // 只对已上架资源计分，且不给自己加分；after() 保证计分不拖慢下载响应
  const refId = rec.counted ? rec.refId : null;
  if (refId && resource.status === "PUBLISHED" && resource.authorId !== userId) {
    after(() =>
      awardPoints({
        userId: resource.authorId,
        actorId: userId,
        reason: "DOWNLOAD_RECEIVED",
        refId,
      }),
    );
  }
  return { ok: true };
}
