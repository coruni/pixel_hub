"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { publicUrl } from "@/lib/storage";
import {
  HOME_KIND_META,
  HOME_SECTION_KINDS,
  safeHomeConfig,
  type HomeSectionKind,
} from "@/lib/home-config";

type Admin = { id: string };

async function adminOnly(): Promise<Admin | null> {
  const s = await auth();
  return s?.user?.role === "ADMIN" ? { id: s.user.id } : null;
}

async function audit(adminId: string, action: string, note?: string, targetId?: string) {
  await prisma.auditLog
    .create({ data: { adminId, action, targetType: "HOMESECTION", targetId: targetId ?? null, note: note ?? null } })
    .catch(() => undefined);
}

function homeRevalidate() {
  revalidatePath("/admin/home");
  revalidatePath("/");
  revalidatePath("/admin");
}

function cleanTitle(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return null;
  return t.slice(0, 80);
}

// ---------- 板块 CRUD ----------

export type HomePatch = {
  id: string;
  title?: string | null;
  enabled?: boolean;
  config?: unknown;
};

/** 保存板块（标题/开关/配置，字段可部分提交；config 仅当 kind 合法时按 schema 校验落库） */
export async function updateHomeSectionAction(patch: HomePatch): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const row = await prisma.homeSection.findUnique({ where: { id: patch.id } });
  if (!row) return { ok: false, error: "板块不存在" };
  const kind = (HOME_SECTION_KINDS as string[]).includes(row.kind) ? (row.kind as HomeSectionKind) : null;
  if (!kind) return { ok: false, error: "板块类型异常" };

  const data: { title?: string | null; enabled?: boolean; config?: string } = {};
  if (patch.title !== undefined) data.title = cleanTitle(patch.title);
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.config !== undefined) {
    const v = safeHomeConfig(kind, patch.config);
    if (!v.ok) return { ok: false, error: v.error };
    data.config = JSON.stringify(v.data);
  }

  await prisma.homeSection.update({ where: { id: patch.id }, data });
  await audit(admin.id, "EDIT_HOME", `${HOME_KIND_META[kind].label}${data.title ? ` · ${data.title}` : ""}`, patch.id);
  homeRevalidate();
  return { ok: true };
}

/** 新增板块（追加到末尾） */
export async function addHomeSectionAction(kind: HomeSectionKind): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (!(HOME_SECTION_KINDS as string[]).includes(kind)) return { ok: false, error: "未知板块类型" };

  const last = await prisma.homeSection.findFirst({ orderBy: { order: "desc" } });
  const cfg = safeHomeConfig(kind, {});
  if (!cfg.ok) return { ok: false, error: cfg.error };

  await prisma.homeSection.create({
    data: {
      kind,
      title: HOME_KIND_META[kind].defaultTitle,
      order: (last?.order ?? 0) + 10,
      enabled: true,
      config: JSON.stringify(cfg.data),
    },
  });
  await audit(admin.id, "ADD_HOME", HOME_KIND_META[kind].label);
  homeRevalidate();
  return { ok: true };
}

/** 删除板块 */
export async function removeHomeSectionAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const row = await prisma.homeSection.findUnique({ where: { id }, select: { id: true, kind: true } });
  if (!row) return { ok: false, error: "板块不存在" };

  await prisma.homeSection.delete({ where: { id } });
  await audit(admin.id, "REMOVE_HOME", row.kind, id);
  homeRevalidate();
  return { ok: true };
}

/** 整页保存排序（ids 为板块 id 列表，即最终顺序） */
export async function reorderHomeSectionsAction(ids: string[]): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const clean = ids.filter((x) => typeof x === "string").slice(0, 40);

  await prisma.$transaction(
    clean.map((id, i) => prisma.homeSection.update({ where: { id }, data: { order: (i + 1) * 10 } }))
  );
  await audit(admin.id, "REORDER_HOME", clean.join(","));
  homeRevalidate();
  return { ok: true };
}

// ---------- hero 挑选资源 ----------

export type ResourcePick = { id: string; title: string; slug: string; type: string; thumbUrl: string | null };

/** 按标题搜索已上架资源（hero 主推挑选器） */
export async function searchResourcesAction(q: string): Promise<{ ok: boolean; items: ResourcePick[]; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作", items: [] };
  const kw = q.trim().slice(0, 50);
  if (!kw) return { ok: true, items: [] };

  const rows = await prisma.resource.findMany({
    where: {
      status: "PUBLISHED",
      OR: [{ title: { contains: kw } }, { summary: { contains: kw } }],
    },
    orderBy: { publishedAt: "desc" },
    take: 20,
    select: {
      id: true,
      title: true,
      slug: true,
      type: true,
      coverMedia: { select: { storageKey: true, bigKey: true, thumbKey: true } },
    },
  });
  return {
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      type: r.type,
      thumbUrl: r.coverMedia
        ? publicUrl(r.coverMedia.thumbKey ?? r.coverMedia.bigKey ?? r.coverMedia.storageKey)
        : null,
    })),
  };
}
