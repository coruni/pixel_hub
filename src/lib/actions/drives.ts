"use server";

// 后台云盘管理（Graph 附件存储驱动器）：全部 ADMIN 守卫 + AuditLog（共享 _guards）。
// 单一活跃盘由 setActive 事务维护；locator 在存在引用后不可换（防旧 /od 链接失效）。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { adminOnly, audit } from "@/lib/actions/_guards";
import {
  countDriveRefs,
  graphEnabled,
  probeDrive,
  recordDriveError,
  recordDriveOk,
  validateLocator,
  validateRootPath,
} from "@/lib/storage/onedrive";

type Result = { ok: true } | { ok: false; error: string };

const cleanLabel = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 40) : "");

export async function createDriveAction(input: {
  label: string;
  locator: string;
  rootPath: string;
}): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const label = cleanLabel(input.label);
  if (!label) return { ok: false, error: "名称必填" };
  const loc = validateLocator(input.locator);
  if (!loc.ok) return { ok: false, error: loc.error };
  const rp = validateRootPath(input.rootPath);
  if (!rp.ok) return { ok: false, error: rp.error };
  const drive = await prisma.cloudDrive.create({
    data: { label, locator: loc.locator, rootPath: rp.rootPath },
  });
  await audit(
    admin.id,
    "CREATE_CLOUD_DRIVE",
    "CLOUD_DRIVE",
    drive.id,
    `新建云盘 ${label}（${loc.locator}）`,
  );
  revalidatePath("/admin/drives");
  return { ok: true };
}

/** 切换活跃盘：事务内先全关再开，保证全局唯一活跃；同时强制启用 */
export async function setActiveDriveAction(input: { id: string }): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const drive = await prisma.cloudDrive.findUnique({ where: { id: input.id } });
  if (!drive) return { ok: false, error: "云盘不存在" };
  await prisma.$transaction(async (tx) => {
    await tx.cloudDrive.updateMany({ where: { active: true }, data: { active: false } });
    await tx.cloudDrive.update({
      where: { id: drive.id },
      data: { active: true, enabled: true },
    });
  });
  await audit(admin.id, "SET_ACTIVE_DRIVE", "CLOUD_DRIVE", drive.id, `切活跃云盘 → ${drive.label}`);
  revalidatePath("/admin/drives");
  return { ok: true };
}

export async function updateDriveAction(input: {
  id: string;
  label?: string;
  locator?: string;
  rootPath?: string;
  enabled?: boolean;
}): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const existing = await prisma.cloudDrive.findUnique({ where: { id: input.id } });
  if (!existing) return { ok: false, error: "云盘不存在" };

  const data: { label?: string; locator?: string; rootPath?: string; enabled?: boolean } = {};
  if (input.label !== undefined) {
    const label = cleanLabel(input.label);
    if (!label) return { ok: false, error: "名称不能为空" };
    if (label !== existing.label) data.label = label;
  }
  if (input.locator !== undefined) {
    const loc = validateLocator(input.locator);
    if (!loc.ok) return { ok: false, error: loc.error };
    if (loc.locator !== existing.locator) {
      // 引用自带盘 id：换 locator 会令存量 /od 链接无法解析 → 拒绝，提示新建盘并切活跃
      const refs = await countDriveRefs(existing.id);
      if (refs > 0)
        return { ok: false, error: `该盘已有 ${refs} 条附件引用，不能更换 locator；请新建盘并切换活跃` };
      data.locator = loc.locator;
    }
  }
  if (input.rootPath !== undefined) {
    const rp = validateRootPath(input.rootPath);
    if (!rp.ok) return { ok: false, error: rp.error };
    if (rp.rootPath !== existing.rootPath) data.rootPath = rp.rootPath;
  }
  if (typeof input.enabled === "boolean" && input.enabled !== existing.enabled)
    data.enabled = input.enabled;

  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.cloudDrive.update({ where: { id: existing.id }, data });
  const bits = Object.entries(data)
    .map(([k, v]) => `${k}=${typeof v === "boolean" ? (v ? "开" : "关") : v}`)
    .join(", ");
  await audit(admin.id, "EDIT_CLOUD_DRIVE", "CLOUD_DRIVE", existing.id, `更新云盘：${bits}`);
  revalidatePath("/admin/drives");
  return { ok: true };
}

export async function deleteDriveAction(input: { id: string }): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const drive = await prisma.cloudDrive.findUnique({ where: { id: input.id } });
  if (!drive) return { ok: false, error: "云盘不存在" };
  if (drive.active)
    return { ok: false, error: "该盘为当前活跃盘，请先在其它盘上设置活跃" };
  const refs = await countDriveRefs(drive.id);
  if (refs > 0)
    return { ok: false, error: `仍被 ${refs} 条附件引用，删除后这些下载会失效（建议保留并停用）` };
  await prisma.cloudDrive.delete({ where: { id: drive.id } });
  await audit(admin.id, "DELETE_CLOUD_DRIVE", "CLOUD_DRIVE", drive.id, `删除云盘 ${drive.label}`);
  revalidatePath("/admin/drives");
  return { ok: true };
}

/** 连通性测试：传临时文件→取下载链接→删除；成功记 lastOkAt，失败记 lastError 并回显原因 */
export async function testDriveAction(input: { id: string }): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const drive = await prisma.cloudDrive.findUnique({ where: { id: input.id } });
  if (!drive) return { ok: false, error: "云盘不存在" };
  if (!graphEnabled())
    return { ok: false, error: "未配置 GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET，无法测试" };
  const r = await probeDrive(drive);
  if (r.ok) {
    await recordDriveOk(drive.id);
    await audit(admin.id, "TEST_CLOUD_DRIVE", "CLOUD_DRIVE", drive.id, `连通测试通过 ${drive.label}（${r.ms}ms）`);
    return { ok: true };
  }
  await recordDriveError(drive.id, r.error);
  await audit(admin.id, "TEST_CLOUD_DRIVE", "CLOUD_DRIVE", drive.id, `连通测试失败 ${drive.label}：${r.error.slice(0, 200)}`);
  return { ok: false, error: r.error };
}
