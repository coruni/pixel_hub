"use server";

// 分类/标签管理（后台 taxonomy）：全部 ADMIN 守卫 + AuditLog（共享 _guards）。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { slugify } from "@/lib/slug";
import { translateToEnglish } from "@/lib/edge-translate";
import { adminOnly, audit } from "@/lib/actions/_guards";

type Result = { ok: true } | { ok: false; error: string };

function revalidateAll() {
  for (const p of ["/", "/browse", "/admin/categories", "/admin/tags"])
    revalidatePath(p);
}

const cleanName = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 40) : "");

// ---------- 分类 ----------

export async function createCategoryAction(input: {
  name: string;
  slug: string;
  parentId?: string | null;
}): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "名称必填" };
  // 子分类：父级必须存在；限制两级（不允许给子分类再建子分类），避免深层循环与 UI 复杂度爆炸
  let parentId: string | null | undefined;
  if (input.parentId) {
    const parent = await prisma.category.findUnique({
      where: { id: input.parentId },
      select: { id: true, parentId: true },
    });
    if (!parent) return { ok: false, error: "父分类不存在" };
    if (parent.parentId) return { ok: false, error: "子分类不能再包含子分类" };
    parentId = parent.id;
  }
  // slug 自动翻译：显式填写的 slug 原样采用；留空则把（含中文的）名称经 Edge 微软翻译成英文再 slugify，利于 SEO
  const explicit = typeof input.slug === "string" ? input.slug.trim() : "";
  const slug = explicit
    ? slugify(explicit)
    : slugify((await translateToEnglish(name)) ?? name) || name;
  if (!slug) return { ok: false, error: "slug 必填（字母/数字/中文）" };
  const hit = await prisma.category.findUnique({ where: { slug } });
  if (hit) return { ok: false, error: `slug「${slug}」已被占用` };
  await prisma.category.create({ data: { name, slug, parentId } });
  await audit(
    admin.id,
    "EDIT_CATEGORY",
    "CATEGORY",
    undefined,
    `新建分类 ${name}(${slug})${parentId ? " [子分类]" : ""}`,
  );
  revalidateAll();
  return { ok: true };
}

export async function updateCategoryAction(input: {
  id: string;
  name?: string;
  slug?: string;
  sort?: number;
}): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const existing = await prisma.category.findUnique({ where: { id: input.id } });
  if (!existing) return { ok: false, error: "分类不存在" };

  const data: { name?: string; slug?: string; sort?: number } = {};

  // 名称：仅当与现状不同才更新；改名不动 slug（slug 由下方显式填写逻辑单独控制）
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name) return { ok: false, error: "名称不能为空" };
    if (name !== existing.name) data.name = name;
  }

  // slug 仅当改动过该字段时才处理：
  // - 传入空字符串 = 用户清空 slug，按（新）名称自动翻译重新生成；
  // - 传入非空 = 原样采用并校验全局唯一；
  // - 未传（只改了名称、没碰 slug 字段）= 保留现有 slug，不重新生成。
  if (input.slug !== undefined) {
    const raw = input.slug.trim();
    if (!raw) {
      const base = data.name ?? existing.name;
      const slug = slugify((await translateToEnglish(base)) ?? base) || base;
      if (slug !== existing.slug) {
        const clash = await prisma.category.findUnique({ where: { slug } });
        if (clash) return { ok: false, error: `自动生成的 slug「${slug}」已被分类「${clash.name}」占用` };
        data.slug = slug;
      }
    } else {
      const slug = slugify(raw);
      if (!slug) return { ok: false, error: "slug 仅含字母/数字/中文" };
      if (slug !== existing.slug) {
        const clash = await prisma.category.findUnique({ where: { slug } });
        if (clash) return { ok: false, error: `slug「${slug}」已被分类「${clash.name}」占用` };
        data.slug = slug;
      }
    }
  }

  if (typeof input.sort === "number" && Number.isFinite(input.sort))
    data.sort = Math.trunc(input.sort);

  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.category.update({ where: { id: input.id }, data });
  await audit(
    admin.id,
    "EDIT_CATEGORY",
    "CATEGORY",
    input.id,
    `更新分类 ${data.name ?? existing.name}(${data.slug ?? existing.slug})`,
  );
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
    return {
      ok: false,
      error: `仍有 ${c._count.resources} 个内容挂在该分类下，先移走或改挂其他分类`,
    };
  }
  await prisma.category.delete({ where: { id: input.id } });
  await audit(admin.id, "EDIT_CATEGORY", "CATEGORY", input.id, `删除分类 ${c.name}(${c.slug})`);
  revalidateAll();
  return { ok: true };
}

// ---------- 标签 ----------

export async function renameTagAction(input: {
  id: string;
  name?: string;
  slug?: string;
}): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const t = await prisma.tag.findUnique({ where: { id: input.id } });
  if (!t) return { ok: false, error: "标签不存在" };

  const rawName = input.name !== undefined ? cleanName(input.name) : t.name;
  if (!rawName) return { ok: false, error: "标签名不能为空" };
  const nameChanged = rawName !== t.name;

  // 改名为已存在的标签名 → 合并（资源关联转挂目标，计数加净增，删旧）
  if (nameChanged) {
    const byName = await prisma.tag.findUnique({ where: { name: rawName } });
    if (byName) {
      await prisma.$transaction(async (tx) => {
        const links = await tx.tagOnResource.findMany({
          where: { tagId: t.id },
          select: { resourceId: true },
        });
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
      await audit(admin.id, "EDIT_TAG", "TAG", t.id, `合并标签 ${t.name} → ${rawName}`);
      revalidateAll();
      return { ok: true };
    }
  }

  // slug 仅当改动过该字段时才处理：
  // - 显式清空（空串）= 按（新）名称自动翻译重新生成；
  // - 非空 = 原样采用并校验全局唯一；
  // - 未传（只改了名称、没碰 slug 字段）= 保留现有 slug，不重新生成。
  let nextSlug = t.slug;
  const rawSlug = input.slug?.trim();
  if (rawSlug !== undefined) {
    if (rawSlug === "") {
      nextSlug = slugify((await translateToEnglish(rawName)) ?? rawName) || t.slug;
      if (nextSlug !== t.slug) {
        const bySlug = await prisma.tag.findFirst({ where: { slug: nextSlug, id: { not: t.id } } });
        if (bySlug) return { ok: false, error: `自动生成的 slug「${nextSlug}」已被标签「${bySlug.name}」占用` };
      }
    } else {
      const s = slugify(rawSlug);
      if (!s) return { ok: false, error: "slug 仅含字母/数字/中文" };
      if (s !== t.slug) {
        const clash = await prisma.tag.findFirst({ where: { slug: s, id: { not: t.id } } });
        if (clash) return { ok: false, error: `slug「${s}」已被标签「${clash.name}」占用` };
        nextSlug = s;
      }
    }
  }

  if (!nameChanged && nextSlug === t.slug) return { ok: true };

  await prisma.tag.update({ where: { id: t.id }, data: { name: rawName, slug: nextSlug } });
  await audit(admin.id, "EDIT_TAG", "TAG", t.id, `重命名标签 ${t.name} → ${rawName}`);
  revalidateAll();
  return { ok: true };
}

export async function deleteTagAction(input: { id: string }): Promise<Result> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const t = await prisma.tag.findUnique({ where: { id: input.id } });
  if (!t) return { ok: false, error: "标签不存在" };
  await prisma.tag.delete({ where: { id: input.id } }); // TagOnResource 级联删除
  await audit(admin.id, "EDIT_TAG", "TAG", input.id, `删除标签 ${t.name}(${t.count})`);
  revalidateAll();
  return { ok: true };
}
