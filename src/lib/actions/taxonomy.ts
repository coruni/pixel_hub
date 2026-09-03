"use server";

// 分类/标签管理（后台 taxonomy）：全部 ADMIN 守卫 + AuditLog。
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { slugify } from "@/lib/slug";

type Result = { ok: true } | { ok: false; error: string };

async function adminOnly(): Promise<{ id: string } | null> {
  const s = await auth();
  return s?.user?.role === "ADMIN" ? { id: s.user.id } : null;
}

async function audit(adminId: string, action: string, note?: string) {
  await prisma.auditLog
    .create({ data: { adminId, action, targetType: "CATEGORY", note: note ?? null } })
    .catch(() => undefined);
}

function revalidateAll() {
  for (const p of ["/", "/browse", "/search", "/admin/categories", "/admin/tags"]) revalidatePath(p);
}

const cleanName = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 40) : "");

// ---------- 分类 ----------

export async function createCategoryAction(input: {
  name: string;
  slug: string;
}): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const name = cleanName(input.name);
  const slug = slugify(typeof input.slug === "string" && input.slug.trim() ? input.slug : name);
  if (!name) return { ok: false, error: "名称必填" };
  if (!slug) return { ok: false, error: "slug 必填（字母/数字/中文）" };
  const hit = await prisma.category.findUnique({ where: { slug } });
  if (hit) return { ok: false, error: `slug「${slug}」已被占用` };
  await prisma.category.create({ data: { name, slug } });
  await audit(admin.id, "EDIT_CATEGORY", `新建分类 ${name}(${slug})`);
  revalidateAll();
  return { ok: true };
}

export async function updateCategoryAction(input: {
  id: string;
  name?: string;
  sort?: number;
}): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const data: { name?: string; sort?: number } = {};
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name) return { ok: false, error: "名称不能为空" };
    data.name = name;
  }
  if (typeof input.sort === "number" && Number.isFinite(input.sort)) data.sort = Math.trunc(input.sort);
  if (Object.keys(data).length === 0) return { ok: true };
  try {
    await prisma.category.update({ where: { id: input.id }, data });
  } catch {
    return { ok: false, error: "分类不存在" };
  }
  await audit(admin.id, "EDIT_CATEGORY", `更新分类 ${data.name ?? input.id}`);
  revalidateAll();
  return { ok: true };
}

export async function deleteCategoryAction(input: { id: string }): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const c = await prisma.category.findUnique({
    where: { id: input.id },
    include: { _count: { select: { resources: true, children: true } } },
  });
  if (!c) return { ok: false, error: "分类不存在" };
  if (c._count.children > 0) return { ok: false, error: "该分类下有子分类，先处理子分类" };
  if (c._count.resources > 0) {
    return { ok: false, error: `仍有 ${c._count.resources} 个内容挂在该分类下，先移走或改挂其他分类` };
  }
  await prisma.category.delete({ where: { id: input.id } });
  await audit(admin.id, "EDIT_CATEGORY", `删除分类 ${c.name}(${c.slug})`);
  revalidateAll();
  return { ok: true };
}

// ---------- 标签 ----------

export async function renameTagAction(input: { id: string; name: string }): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "标签名不能为空" };
  const t = await prisma.tag.findUnique({ where: { id: input.id } });
  if (!t) return { ok: false, error: "标签不存在" };
  if (t.name === name) return { ok: true };
  const byName = await prisma.tag.findUnique({ where: { name } });
  if (byName) {
    // 同名合并：把旧标签的资源关联转挂到目标标签（已存在的跳过），计数只加净增，然后删旧
    await prisma.$transaction(async (tx) => {
      const links = await tx.tagOnResource.findMany({ where: { tagId: t.id }, select: { resourceId: true } });
      const ids = links.map((l) => l.resourceId);
      const existing = await tx.tagOnResource.findMany({
        where: { tagId: byName.id, resourceId: { in: ids } },
        select: { resourceId: true },
      });
      const fresh = ids.filter((id) => !existing.some((e) => e.resourceId === id));
      for (const id of fresh) {
        await tx.tagOnResource.create({ data: { resourceId: id, tagId: byName.id } });
      }
      await tx.tagOnResource.deleteMany({ where: { tagId: t.id } });
      await tx.tag.update({
        where: { id: byName.id },
        data: { count: { increment: fresh.length } },
      });
      await tx.tag.delete({ where: { id: t.id } });
    });
    await audit(admin.id, "EDIT_TAG", `合并标签 ${t.name} → ${name}`);
    revalidateAll();
    return { ok: true };
  }
  const slug = slugify(name) || t.slug;
  const bySlug = await prisma.tag.findFirst({ where: { slug, id: { not: t.id } } });
  if (bySlug) return { ok: false, error: `slug「${slug}」已被标签「${bySlug.name}」占用` };
  await prisma.tag.update({ where: { id: t.id }, data: { name, slug } });
  await audit(admin.id, "EDIT_TAG", `重命名标签 ${t.name} → ${name}`);
  revalidateAll();
  return { ok: true };
}

export async function deleteTagAction(input: { id: string }): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const t = await prisma.tag.findUnique({ where: { id: input.id } });
  if (!t) return { ok: false, error: "标签不存在" };
  await prisma.tag.delete({ where: { id: input.id } }); // TagOnResource 级联删除
  await audit(admin.id, "EDIT_TAG", `删除标签 ${t.name}(${t.count})`);
  revalidateAll();
  return { ok: true };
}
