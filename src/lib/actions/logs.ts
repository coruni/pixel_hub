"use server";

// 操作日志维护（后台 /admin/logs）：清空审计日志，仅管理员。
// 关键约定：清空本身必须留痕——删完在同一事务里补写一条 DELETE_AUDIT_LOG，
// 否则「清空即抹除」，追溯链会断在最后一步。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { adminOnly } from "@/lib/actions/_guards";
import { isKnownLogAction, logActionText, logWhere } from "@/lib/admin/logs";

export type ClearLogsResult = { ok: boolean; error?: string; removed?: number };

/**
 * 清空操作日志。scope 与日志页筛选同源（action / adminId 为空即不限），
 * 即「所见即所删」：带筛选时只删当前筛选命中的记录。
 * 仅 ADMIN——MODERATOR 能看日志但不能清（页面也不给入口，此处再兜一层）。
 */
export async function clearAuditLogsAction(scope: {
  action?: string;
  adminId?: string;
}): Promise<ClearLogsResult> {
  const me = await adminOnly();
  if (!me) return { ok: false, error: "仅管理员可清空操作日志" };

  const action = scope.action ?? "";
  const adminId = scope.adminId ?? "";
  // 白名单校验：非法动作值不再当成「无筛选」放行，避免参数被篡改成「清空全部」
  if (!isKnownLogAction(action)) return { ok: false, error: "筛选条件无效，请刷新后重试" };

  const where = logWhere(action, adminId);
  const operator = adminId
    ? await prisma.user.findUnique({ where: { id: adminId }, select: { username: true } })
    : null;
  const scopeText = [
    action ? `动作=${logActionText(action)}` : "",
    adminId ? `操作人=@${operator?.username ?? "已删除"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  try {
    const removed = await prisma.$transaction(async (tx) => {
      const res = await tx.auditLog.deleteMany({ where });
      // 与删除同事务补写留痕：要么都成功、要么都回滚，不留「删了却没记录」的窗口。
      // 这里不走 audit() 助手是因为它用全局 client，无法并入本事务。
      await tx.auditLog.create({
        data: {
          adminId: me.id,
          action: "DELETE_AUDIT_LOG",
          targetType: "AUDIT_LOG",
          note: `清空操作日志 ${res.count} 条${scopeText ? `（${scopeText}）` : ""}`,
        },
      });
      return res.count;
    });

    revalidatePath("/admin/logs");
    return { ok: true, removed };
  } catch (e) {
    console.error("[clearAuditLogs]", e);
    return { ok: false, error: "清空失败，请稍后重试" };
  }
}
