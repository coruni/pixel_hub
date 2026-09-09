"use server";

// 后台内容库：版主/管理员改稿。
// 边界（与发布流程对齐）：只改文案/分类/标签/meta/可见性四项；
// slug、作者、媒体、计数与历史版本一律不动，避免后台编辑把公开内容与统计数据改坏。
// 实际字段解析 + 写库 + 标签同步见 _resource-edit（后台与作者共用，避免两套逻辑漂移）。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { audit, staff } from "@/lib/actions/_guards";
import { applyResourceEdit, type ResourceEditState } from "@/lib/actions/_resource-edit";
import { syncResourceSearch } from "@/lib/search";

export type AdminResourceState = ResourceEditState;

export async function updateResourceAdminAction(
  _prev: AdminResourceState,
  fd: FormData,
): Promise<AdminResourceState> {
  const me = await staff();
  if (!me) return { error: "无权限" };

  const id = String(fd.get("id") ?? "");
  if (!id) return { error: "缺少资源" };

  const resource = await prisma.resource.findUnique({
    where: { id },
    select: { id: true, type: true, slug: true },
  });
  if (!resource) return { error: "资源不存在" };

  try {
    const res = await prisma.$transaction(async (tx) =>
      applyResourceEdit(tx, id, resource.type, fd, me.id),
    );
    if (res.fieldErrors) return { fieldErrors: res.fieldErrors };
  } catch (e) {
    console.error("[updateResourceAdmin]", e);
    return { error: "保存失败，请稍后重试" };
  }

  // 全文索引同步（正文已变更；失败仅告警，不影响保存结果）
  await syncResourceSearch(id);

  await audit(me.id, "UPDATE_RESOURCE", "RESOURCE", id, resource.slug);
  revalidatePath("/admin/content");
  revalidatePath(`/admin/content/${id}/edit`);
  revalidatePath(`/resources/${resource.slug}`);
  revalidatePath("/", "layout");
  return { ok: true };
}
