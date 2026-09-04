"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { REASONS, REPORT_AUTO_HIDE_AT } from "@/lib/report-options";

export async function reportResourceAction(
  resourceId: string,
  reason: string,
  detail?: string
): Promise<{ ok: boolean; error?: string }> {
  const user = (await auth())?.user;
  if (!user) return { ok: false, error: "请先登录" };
  // 举报限流：每用户 10 次 / 10 分钟（防刷举报压垮审核队列）
  if (!rateLimit(`report:${user.id}`, 10, 10 * 60_000)) return { ok: false, error: "举报过于频繁，请稍后再试" };
  const clean = reason.trim().slice(0, 40) || "其他";
  if (!(REASONS as readonly string[]).includes(clean)) return { ok: false, error: "举报理由不合法" };

  // 目标须是已发布内容（已因举报进入复查的 PENDING 也放行以继续累积）；
  // 已下架/打回的内容不再受理举报。
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, slug: true, title: true, authorId: true, status: true },
  });
  if (!resource || (resource.status !== "PUBLISHED" && resource.status !== "PENDING")) {
    return { ok: false, error: "资源不存在" };
  }

  // 同一举报人重复举报同一内容则忽略（已处理过的可再次举报）
  const dup = await prisma.report.findFirst({
    where: { reporterId: user.id, targetResourceId: resourceId, status: "OPEN" },
  });
  if (dup) return { ok: false, error: "你已举报过该内容，管理员将尽快处理" };

  await prisma.report.create({
    data: {
      reporterId: user.id,
      type: "RESOURCE",
      targetResourceId: resourceId,
      reason: clean,
      detail: detail?.trim().slice(0, 500) || undefined,
    },
  });

  // 达阈值 → 自动转 PENDING 待人工复查，并通知作者
  const openCount = await prisma.report.count({
    where: { targetResourceId: resourceId, status: "OPEN" },
  });
  if (resource.status === "PUBLISHED" && openCount >= REPORT_AUTO_HIDE_AT) {
    await prisma.resource.update({
      where: { id: resourceId },
      data: { status: "PENDING", rejectReason: null },
    });
    await prisma.notification.create({
      data: {
        userId: resource.authorId,
        type: "MODERATION",
        resourceId,
        message: `你的内容「${resource.title}」因收到 ${openCount} 条举报已转为待人工复查，核查通过后将自动恢复上架。`,
      },
    });
    revalidatePath("/", "layout");
    revalidatePath(`/resources/${resource.slug}`);
    revalidatePath("/admin/reports");
    revalidatePath("/admin/queue");
  }
  return { ok: true };
}
