// server actions 共用的权限守卫与审计日志（各 action 文件统一引用，不再各自复制）。
// 注意：本文件不加 "use server"——它只作为模块被 action 内部调用，导出成 server action 反而暴露攻击面。
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export type StaffUser = { id: string; role: "ADMIN" | "MODERATOR" };

/** 版主及以上（ADMIN / MODERATOR） */
export async function staff(): Promise<StaffUser | null> {
  const s = await auth();
  const role = s?.user?.role;
  return role === "ADMIN" || role === "MODERATOR" ? { id: s!.user!.id, role } : null;
}

/** 仅管理员 */
export async function adminOnly(): Promise<StaffUser | null> {
  const s = await auth();
  return s?.user?.role === "ADMIN" ? { id: s.user.id, role: "ADMIN" as const } : null;
}

/**
 * 审计日志：失败不阻断主流程，但必须留下排查线索（静默吞错会让后台操作失去追溯能力）。
 * 签名与 AuditLog 行对齐：targetType/targetId/note 均可省。
 */
export async function audit(
  adminId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  note?: string,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { adminId, action, targetType, targetId: targetId ?? null, note: note ?? null },
    });
  } catch (e) {
    console.error("[audit]", e);
  }
}
