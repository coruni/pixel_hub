"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { notifyByEmail } from "@/lib/mail-notify";
import { adminOnly, audit, staff } from "@/lib/actions/_guards";

async function notifyMod(userId: string, actorId: string, resourceId: string, message: string) {
  if (!userId || userId === actorId) return;
  await prisma.notification
    .create({ data: { userId, actorId, type: "MODERATION", resourceId, message } })
    .catch(() => undefined);

  // 审核结果邮件提醒：after() 在响应后继续执行（不丢任务，也不拖慢 action）
  after(async () => {
    const resource = await prisma.resource
      .findUnique({ where: { id: resourceId }, select: { slug: true, title: true } })
      .catch(() => null);
    if (!resource) return;
    await notifyByEmail(userId, "你的投稿有审核结果", `《${resource.title}》：${message}`, `/resources/${resource.slug}`);
  });
}

// ---------- 审核队列 ----------
export async function approveResourceAction(resourceId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await staff();
  if (!admin) return { ok: false, error: "无权限" };
  const r = await prisma.resource.findUnique({ where: { id: resourceId }, select: { id: true, authorId: true } });
  if (!r) return { ok: false, error: "资源不存在" };

  await prisma.resource.update({
    where: { id: resourceId },
    data: { status: "PUBLISHED", publishedAt: new Date(), rejectReason: null },
  });
  await audit(admin.id, "APPROVE", "RESOURCE", resourceId);
  await notifyMod(r.authorId, admin.id, resourceId, "你的内容已通过审核并上架 🎉");
  revalidatePath("/admin");
  revalidatePath("/admin/queue");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectResourceAction(
  resourceId: string,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  const admin = await staff();
  if (!admin) return { ok: false, error: "无权限" };
  const clean = reason.trim().slice(0, 300);
  if (!clean) return { ok: false, error: "请填写打回原因" };
  const r = await prisma.resource.findUnique({ where: { id: resourceId }, select: { id: true, authorId: true } });
  if (!r) return { ok: false, error: "资源不存在" };

  await prisma.resource.update({
    where: { id: resourceId },
    data: { status: "REJECTED", rejectReason: clean },
  });
  await audit(admin.id, "REJECT", "RESOURCE", resourceId, clean);
  await notifyMod(r.authorId, admin.id, resourceId, `内容被打回：${clean}`);
  revalidatePath("/admin");
  revalidatePath("/admin/queue");
  return { ok: true };
}

// ---------- 内容库：下架 / 恢复 ----------
export async function setResourceRemoved(resourceId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await staff();
  if (!admin) return { ok: false, error: "无权限" };
  const r = await prisma.resource.updateMany({
    where: { id: resourceId },
    data: { status: "REMOVED" },
  });
  if (r.count === 0) return { ok: false, error: "资源不存在" };
  const res = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { title: true, authorId: true },
  });
  await audit(admin.id, "REMOVE_RESOURCE", "RESOURCE", resourceId, res?.title);
  if (res) await notifyMod(res.authorId, admin.id, resourceId, "你的内容已被下架，如有疑问请联系管理员");
  revalidatePath("/admin");
  revalidatePath("/admin/content");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function restoreResource(resourceId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await staff();
  if (!admin) return { ok: false, error: "无权限" };
  const r = await prisma.resource.updateMany({
    where: { id: resourceId },
    data: { status: "PUBLISHED", publishedAt: new Date(), rejectReason: null },
  });
  if (r.count === 0) return { ok: false, error: "资源不存在" };
  await audit(admin.id, "RESTORE", "RESOURCE", resourceId);
  revalidatePath("/admin");
  revalidatePath("/admin/content");
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------- 举报 ----------
// 按「同一目标」批量关闭全部 OPEN 举报，并联动资源状态：
//   RESOURCE + dismiss  → 若正因举报暂挂 PENDING 则复核通过恢复上架
//   RESOURCE + confirm  → 确认违规：下架（REMOVED）
//   COMMENT / USER      → 仅关闭举报（内容侧治理暂不做自动动作）
export async function handleReportBatchAction(input: {
  type: "RESOURCE" | "COMMENT" | "USER";
  resourceId?: string | null;
  commentId?: string | null;
  userId?: string | null;
  decision: "dismiss" | "confirm";
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await staff();
  if (!admin) return { ok: false, error: "无权限" };

  // 目标 id 必须与 type 匹配且非空，否则 where 落到「该列为 null 的全部举报」误关别类举报
  const targetId = input.resourceId ?? input.commentId ?? input.userId ?? "";
  if (!targetId || targetId === "?") return { ok: false, error: "缺少举报目标" };

  const closed = await prisma.report.updateMany({
    where: {
      type: input.type,
      status: "OPEN",
      ...(input.type === "RESOURCE"
        ? { targetResourceId: targetId }
        : input.type === "COMMENT"
          ? { targetCommentId: targetId }
          : { targetUserId: targetId }),
    },
    data: { status: input.decision === "confirm" ? "RESOLVED" : "DISMISSED", handledBy: admin.id, handledAt: new Date() },
  });
  if (closed.count === 0) return { ok: false, error: "没有待处理举报" };
  await audit(admin.id, input.decision === "confirm" ? "REPORT_RESOLVE" : "REPORT_DISMISS", input.type, targetId);

  if (input.type === "RESOURCE" && input.resourceId) {
    const res = await prisma.resource.findUnique({
      where: { id: input.resourceId },
      select: { id: true, slug: true, title: true, authorId: true, status: true },
    });
    // 已下架内容不重复动作，只关闭举报
    if (res && res.status !== "REMOVED") {
      if (input.decision === "confirm") {
        // 下架 + 通知同事务：状态与提醒不会出现一边成功一边失败
        await prisma.$transaction([
          prisma.resource.update({ where: { id: res.id }, data: { status: "REMOVED" } }),
          prisma.notification.create({
            data: {
              userId: res.authorId,
              actorId: admin.id,
              type: "MODERATION",
              resourceId: res.id,
              message: `你的内容「${res.title}」因举报被确认违规，已下架。如有疑问请联系管理员`,
            },
          }),
        ]);
        await audit(admin.id, "REMOVE_RESOURCE", "RESOURCE", res.id, res.title);
        await notifyByEmail(res.authorId, "你的内容因举报被下架", `《${res.title}》：经核查确认违规，已下架。如有疑问请联系管理员`, `/resources/${res.slug}`).catch(() => undefined);
        revalidatePath(`/resources/${res.slug}`);
      } else if (res.status === "PENDING") {
        await prisma.$transaction([
          prisma.resource.update({
            where: { id: res.id },
            data: { status: "PUBLISHED", publishedAt: new Date(), rejectReason: null },
          }),
          prisma.notification.create({
            data: {
              userId: res.authorId,
              actorId: admin.id,
              type: "MODERATION",
              resourceId: res.id,
              message: `你的内容「${res.title}」经核查无违规，已恢复上架`,
            },
          }),
        ]);
        await audit(admin.id, "RESTORE", "RESOURCE", res.id);
        revalidatePath(`/resources/${res.slug}`);
      }
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/reports");
  revalidatePath("/admin/queue");
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------- 用户管理（仅 ADMIN） ----------
export async function setUserTrusted(userId: string, trusted: boolean): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  // updateMany + count 预检：目标不存在时不抛 P2025 500，给友好错误
  const r = await prisma.user.updateMany({ where: { id: userId }, data: { trusted } });
  if (r.count === 0) return { ok: false, error: "用户不存在" };
  await audit(admin.id, trusted ? "TRUST" : "UNTRUST", "USER", userId);
  revalidatePath("/admin/users");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setUserRole(
  userId: string,
  role: "USER" | "MODERATOR" | "ADMIN"
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (userId === admin.id && role !== "ADMIN") return { ok: false, error: "不能修改自己的角色" };
  const r = await prisma.user.updateMany({ where: { id: userId }, data: { role } });
  if (r.count === 0) return { ok: false, error: "用户不存在" };
  await audit(admin.id, "SET_ROLE", "USER", userId, role);
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function setUserBanned(
  userId: string,
  banned: boolean,
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (userId === admin.id) return { ok: false, error: "不能封禁自己" };
  const r = await prisma.user.updateMany({
    where: { id: userId },
    data: banned ? { bannedAt: new Date(), bannedReason: reason?.slice(0, 200) || null, trusted: false } : { bannedAt: null, bannedReason: null },
  });
  if (r.count === 0) return { ok: false, error: "用户不存在" };
  await audit(admin.id, banned ? "BAN" : "UNBAN", "USER", userId, banned ? reason || undefined : undefined);
  revalidatePath("/admin/users");
  return { ok: true };
}
