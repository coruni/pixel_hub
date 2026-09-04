"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  SIDEBAR_KIND_META,
  SIDEBAR_WIDGET_KINDS,
  THEME_KEY,
  WIDGET_AREA_KEYS,
  getAreaWidgets,
  parseNavItem,
  parseTheme,
  safeSidebarConfig,
  serializeTheme,
  withAreaWidgets,
  type DetailTemplateId,
  type NavItem,
  type SidebarWidget,
  type SidebarWidgetConfig,
  type SidebarWidgetKind,
  type Theme,
  type WidgetAreaKey,
} from "@/lib/site-config";
import type { ContentType } from "@/lib/display";

type Admin = { id: string };

async function adminOnly(): Promise<Admin | null> {
  const s = await auth();
  return s?.user?.role === "ADMIN" ? { id: s.user.id } : null;
}

async function audit(adminId: string, action: string, note?: string) {
  await prisma.auditLog
    .create({ data: { adminId, action, targetType: "THEME", note: note ?? null } })
    .catch(() => undefined);
}

function themeRevalidate() {
  // 前台动态页每次请求现读 DB；这里刷新路由缓存与后台自身
  revalidatePath("/admin/site");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/browse");
  revalidatePath("/search");
}

function uid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `w-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

async function readThemeDoc(): Promise<Theme> {
  const row = await prisma.siteSetting.findUnique({ where: { key: THEME_KEY } });
  if (!row) return parseTheme(null);
  let value: unknown = null;
  try {
    value = JSON.parse(row.value);
  } catch {
    value = null;
  }
  return parseTheme(value);
}

async function writeThemeDoc(theme: Theme): Promise<void> {
  const value = serializeTheme(theme);
  await prisma.siteSetting.upsert({
    where: { key: THEME_KEY },
    create: { key: THEME_KEY, value },
    update: { value },
  });
}

function cleanTitle(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) return null;
  return t.slice(0, 80);
}

// ---------- 侧边栏：页面开关 / sticky / 宽度 ----------

export async function updateSidebarFlagsAction(patch: {
  showOn?: Partial<Record<"home" | "archive" | "detail", boolean>>;
  sticky?: boolean;
  width?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const theme = await readThemeDoc();
  if (patch.showOn) {
    const k = ["home", "archive", "detail"] as const;
    for (const key of k) {
      if (typeof patch.showOn[key] === "boolean") theme.sidebar.showOn[key] = patch.showOn[key]!;
    }
  }
  if (typeof patch.sticky === "boolean") theme.sidebar.sticky = patch.sticky;
  if (typeof patch.width === "number" && Number.isFinite(patch.width)) {
    theme.sidebar.width = Math.max(260, Math.min(420, Math.round(patch.width)));
  }

  await writeThemeDoc(theme);
  await audit(admin.id, "EDIT_THEME_SIDEBAR", JSON.stringify(patch));
  themeRevalidate();
  return { ok: true };
}

// ---------- 侧边栏 / 内容槽位 widget CRUD ----------
// 区域 = 3 个侧边栏页面（home/archive/detail）+ 5 个内容槽位（详情上/中/下 + 归档上/下）

function validArea(a: unknown): a is WidgetAreaKey {
  return (WIDGET_AREA_KEYS as string[]).includes(a as WidgetAreaKey);
}

/** 在全部区域列表里定位 widget：返回区域 key 与下标（id 由 uid() 生成全局唯一） */
function findWidget(theme: Theme, id: string): { area: WidgetAreaKey; idx: number } | null {
  for (const area of WIDGET_AREA_KEYS) {
    const idx = getAreaWidgets(theme, area).findIndex((w) => w.id === id);
    if (idx >= 0) return { area, idx };
  }
  return null;
}

/** 追加一个 widget（默认配置，追加到指定区域的末尾） */
export async function addSidebarWidgetAction(
  kind: SidebarWidgetKind,
  area: WidgetAreaKey
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (!(SIDEBAR_WIDGET_KINDS as string[]).includes(kind)) return { ok: false, error: "未知组件类型" };
  if (!validArea(area)) return { ok: false, error: "区域不合法" };

  const theme = await readThemeDoc();
  const cfg = safeSidebarConfig(kind, {});
  if (!cfg.ok) return { ok: false, error: cfg.error };
  const widget: SidebarWidget = {
    id: uid(),
    kind,
    title: SIDEBAR_KIND_META[kind].defaultTitle,
    enabled: true,
    config: cfg.data,
  };
  await writeThemeDoc(withAreaWidgets(theme, area, [...getAreaWidgets(theme, area), widget]));
  await audit(admin.id, "ADD_THEME_WIDGET", `${area}/${SIDEBAR_KIND_META[kind].label}`);
  themeRevalidate();
  return { ok: true };
}

export async function removeSidebarWidgetAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const theme = await readThemeDoc();
  const at = findWidget(theme, id);
  if (!at) return { ok: false, error: "组件不存在" };
  const w = getAreaWidgets(theme, at.area)[at.idx];
  await writeThemeDoc(withAreaWidgets(theme, at.area, getAreaWidgets(theme, at.area).filter((x) => x.id !== id)));
  await audit(admin.id, "REMOVE_THEME_WIDGET", `${at.area}/${w.kind}`);
  themeRevalidate();
  return { ok: true };
}

export type SidebarWidgetPatch = { id: string; title?: string | null; enabled?: boolean; config?: unknown };

export async function updateSidebarWidgetAction(patch: SidebarWidgetPatch): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const theme = await readThemeDoc();
  const at = findWidget(theme, patch.id);
  if (!at) return { ok: false, error: "组件不存在" };
  const list = getAreaWidgets(theme, at.area);
  const widget = { ...list[at.idx] };

  if (patch.title !== undefined) widget.title = cleanTitle(patch.title);
  if (patch.enabled !== undefined) widget.enabled = patch.enabled;
  if (patch.config !== undefined) {
    const v = safeSidebarConfig(widget.kind, patch.config);
    if (!v.ok) return { ok: false, error: v.error };
    widget.config = v.data as SidebarWidgetConfig;
  }
  list[at.idx] = widget;
  await writeThemeDoc(withAreaWidgets(theme, at.area, list));
  await audit(admin.id, "EDIT_THEME_WIDGET", `${at.area}/${widget.kind}`);
  themeRevalidate();
  return { ok: true };
}

/** 保存指定区域的 widget 顺序（ids 为该区域最终顺序） */
export async function reorderSidebarWidgetsAction(
  area: WidgetAreaKey,
  ids: string[]
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (!validArea(area)) return { ok: false, error: "区域不合法" };
  const theme = await readThemeDoc();
  const list = getAreaWidgets(theme, area);
  const map = new Map(list.map((w) => [w.id, w]));
  const next: SidebarWidget[] = [];
  for (const id of ids) {
    const w = map.get(id);
    if (w) next.push(w);
  }
  for (const w of list) if (!next.includes(w)) next.push(w);
  await writeThemeDoc(withAreaWidgets(theme, area, next));
  await audit(admin.id, "REORDER_THEME_WIDGET", `${area}:${ids.join(",")}`);
  themeRevalidate();
  return { ok: true };
}

// ---------- 详情页模板默认 ----------

export async function setDetailTemplateAction(patch: {
  scope: "default" | ContentType;
  value: DetailTemplateId | "";
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (patch.scope !== "default" && patch.scope !== "IMAGE" && patch.scope !== "GAME" && patch.scope !== "ARTICLE")
    return { ok: false, error: "作用域不合法" };

  const theme = await readThemeDoc();
  if (patch.scope === "default") {
    if (!patch.value) return { ok: false, error: "模板不合法" };
    theme.detailTemplate.default = patch.value;
  } else if (patch.value === "") {
    // 空值 = 清除类型覆盖，跟随全局默认
    delete theme.detailTemplate.byType[patch.scope];
  } else {
    theme.detailTemplate.byType[patch.scope] = patch.value;
  }
  await writeThemeDoc(theme);
  await audit(admin.id, "EDIT_THEME_DETAIL_TPL", `${patch.scope}:${patch.value}`);
  themeRevalidate();
  return { ok: true };
}

// ---------- 顶部导航栏 ----------

/** 全量保存导航项（含顺序、启停、可见性）。items 为最终顺序。 */
export async function updateNavbarAction(items: unknown): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const arr = Array.isArray(items) ? items : [];
  const clean = arr.map(parseNavItem).filter((x): x is NavItem => x !== null);
  if (clean.length === 0) return { ok: false, error: "请至少保留一个有效的导航项" };

  const theme = await readThemeDoc();
  theme.navbar.items = clean;
  await writeThemeDoc(theme);
  await audit(admin.id, "EDIT_THEME_NAV", clean.map((i) => i.label).join(","));
  themeRevalidate();
  return { ok: true };
}

/** 导航「分类」下拉菜单开关/文案 */
export async function updateCategoriesMenuAction(cfg: {
  enabled: boolean;
  label: string;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const label = cfg.label.trim().slice(0, 12) || "分类";

  const theme = await readThemeDoc();
  theme.navbar.categoriesMenu = { enabled: cfg.enabled === true, label };
  await writeThemeDoc(theme);
  await audit(admin.id, "EDIT_THEME_NAV", `分类菜单 ${cfg.enabled ? "开" : "关"}(${label})`);
  themeRevalidate();
  return { ok: true };
}
