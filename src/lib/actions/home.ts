"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { HOME_SECTIONS_CACHE_TAG } from "@/lib/home";
import { adminOnly, audit } from "@/lib/actions/_guards";
import { publicUrl } from "@/lib/storage";
import {
  HOME_KIND_META,
  HOME_SECTION_KINDS,
  parseSectionConfig,
  safeHomeConfig,
  type HomeSectionKind,
} from "@/lib/home-config";

function homeRevalidate() {
  revalidateTag(HOME_SECTIONS_CACHE_TAG, "max");
  revalidatePath("/admin/site"); // 首页布局已并入站点布局页
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
  /** 设备端可见性：all / pc / mobile */
  visibleOn?: "all" | "pc" | "mobile";
  /** 是否仅登录用户可见 */
  requireAuth?: boolean;
  config?: unknown;
};

/** 保存板块（标题/开关/配置/可见性，字段可部分提交；config 仅当 kind 合法时按 schema 校验落库） */
export async function updateHomeSectionAction(
  patch: HomePatch,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const row = await prisma.homeSection.findUnique({ where: { id: patch.id } });
  if (!row) return { ok: false, error: "板块不存在" };
  const kind = (HOME_SECTION_KINDS as string[]).includes(row.kind)
    ? (row.kind as HomeSectionKind)
    : null;
  if (!kind) return { ok: false, error: "板块类型异常" };

  const data: {
    title?: string | null;
    enabled?: boolean;
    visibleOn?: string;
    requireAuth?: boolean;
    config?: string;
  } = {};
  if (patch.title !== undefined) data.title = cleanTitle(patch.title);
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.visibleOn !== undefined) {
    data.visibleOn = patch.visibleOn === "pc" || patch.visibleOn === "mobile" ? patch.visibleOn : "all";
  }
  if (patch.requireAuth !== undefined) data.requireAuth = patch.requireAuth === true;
  if (patch.config !== undefined) {
    const v = safeHomeConfig(kind, patch.config);
    if (!v.ok) return { ok: false, error: v.error };
    data.config = JSON.stringify(v.data);
  }

  await prisma.homeSection.update({ where: { id: patch.id }, data });
  await audit(
    admin.id,
    "EDIT_HOME",
    "HOMESECTION",
    patch.id,
    `${HOME_KIND_META[kind].label}${data.title ? ` · ${data.title}` : ""}`,
  );
  homeRevalidate();
  return { ok: true };
}

/** 新增板块（追加到末尾） */
export async function addHomeSectionAction(
  kind: HomeSectionKind,
): Promise<{ ok: boolean; error?: string }> {
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
  await audit(admin.id, "ADD_HOME", "HOMESECTION", undefined, HOME_KIND_META[kind].label);
  homeRevalidate();
  return { ok: true };
}

/** 删除板块 */
export async function removeHomeSectionAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const row = await prisma.homeSection.findUnique({
    where: { id },
    select: { id: true, kind: true },
  });
  if (!row) return { ok: false, error: "板块不存在" };

  await prisma.homeSection.delete({ where: { id } });
  await audit(admin.id, "REMOVE_HOME", "HOMESECTION", id, row.kind);
  homeRevalidate();
  return { ok: true };
}

/** 整页保存排序（ids 为板块 id 列表，即最终顺序；已不存在的板块 id 自动过滤） */
export async function reorderHomeSectionsAction(
  ids: string[],
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  // 先过滤到实际存在的板块：脏 id 会让 update 抛 P2025 导致整个事务 500
  const rows = await prisma.homeSection.findMany({ select: { id: true } });
  const existing = new Set(rows.map((r) => r.id));
  const clean = ids.filter((x) => typeof x === "string" && existing.has(x)).slice(0, 40);
  if (clean.length === 0) return { ok: true };

  try {
    await prisma.$transaction(
      clean.map((id, i) =>
        prisma.homeSection.update({ where: { id }, data: { order: (i + 1) * 10 } }),
      ),
    );
  } catch {
    return { ok: false, error: "排序保存失败，请刷新后重试" };
  }
  await audit(admin.id, "REORDER_HOME", "HOMESECTION", undefined, clean.join(","));
  homeRevalidate();
  return { ok: true };
}

// ---------- 首页精选位：把资源一键加入「专题」板块 ----------

/** 专题板块最多挑几个资源；**必须与 home-config.ts 的 featuredCfg.featuredIds 上限一致** */
const FEATURED_MAX = 24;

/**
 * 把某个资源追加进第一个 `featured` 板块的 `config.featuredIds`。
 *
 * 为什么不直接复用 updateHomeSectionAction：那个 action 收的是**整份 config**，调用方得先读、
 * 改、再整包写回 —— 包一层放这里，调用方只要给一个资源 id，也不会因为漏搬字段而丢配置
 * （整包覆盖是这种「读改写」最经典的踩坑点）。
 *
 * 找不到 featured 板块时**明确报错**，不偷偷塞进 hero：hero 的 featuredIds 上限是 8、
 * 且它是首屏大图位，语义与「专题」完全不同 —— 自动挑落点会让「点了一下到底改了什么」不可预期。
 */
export async function addResourceToFeaturedSectionAction(
  resourceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const res = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, title: true },
  });
  if (!res) return { ok: false, error: "资源不存在" };

  // 存在多个专题板块时取最靠上的那个（order 升序）—— 「主专题」最自然的理解
  const row = await prisma.homeSection.findFirst({
    where: { kind: "featured" },
    orderBy: { order: "asc" },
  });
  if (!row) return { ok: false, error: "首页还没有「专题」板块，请先到首页装修里添加" };

  const cfg = parseSectionConfig("featured", row.config);
  // 收窄：parseSectionConfig 的返回类型是按 kind 的宽联合，这里用字段存在性分辨
  if (!("featuredIds" in cfg)) return { ok: false, error: "板块配置异常，请到首页装修里检查" };
  if (cfg.featuredIds.includes(resourceId)) return { ok: false, error: "该资源已经在专题里了" };
  if (cfg.featuredIds.length >= FEATURED_MAX) {
    return { ok: false, error: `专题最多 ${FEATURED_MAX} 个，请先移除一些` };
  }

  const next = safeHomeConfig("featured", { ...cfg, featuredIds: [...cfg.featuredIds, resourceId] });
  if (!next.ok) return { ok: false, error: next.error };

  await prisma.homeSection.update({
    where: { id: row.id },
    data: { config: JSON.stringify(next.data) },
  });
  await audit(admin.id, "ADD_FEATURED_RESOURCE", "HOMESECTION", row.id, `+ ${res.title}`);
  homeRevalidate();
  return { ok: true };
}

// ---------- hero 挑选资源 ----------

export type ResourcePick = {
  id: string;
  title: string;
  slug: string;
  type: string;
  thumbUrl: string | null;
};

/** 按标题搜索已上架资源（hero 主推挑选器） */
export async function searchResourcesAction(
  q: string,
): Promise<{ ok: boolean; items: ResourcePick[]; error?: string }> {
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
