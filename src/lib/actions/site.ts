"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  SIDEBAR_KIND_META,
  SIDEBAR_WIDGET_KINDS,
  THEME_KEY,
  parseNavItem,
  parseTheme,
  safeSidebarConfig,
  serializeTheme,
  type DetailTemplateId,
  type NavItem,
  type SidebarWidget,
  type SidebarWidgetConfig,
  type SidebarWidgetKind,
  type Theme,
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

// ---------- 侧边栏 widget CRUD ----------

/** 追加一个侧边栏 widget（默认配置，追加到末尾） */
export async function addSidebarWidgetAction(
  kind: SidebarWidgetKind
): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (!(SIDEBAR_WIDGET_KINDS as string[]).includes(kind)) return { ok: false, error: "未知组件类型" };

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
  theme.sidebar.widgets.push(widget);
  await writeThemeDoc(theme);
  await audit(admin.id, "ADD_THEME_WIDGET", `${SIDEBAR_KIND_META[kind].label}`);
  themeRevalidate();
  return { ok: true };
}

export async function removeSidebarWidgetAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const theme = await readThemeDoc();
  const w = theme.sidebar.widgets.find((x) => x.id === id);
  if (!w) return { ok: false, error: "组件不存在" };
  theme.sidebar.widgets = theme.sidebar.widgets.filter((x) => x.id !== id);
  await writeThemeDoc(theme);
  await audit(admin.id, "REMOVE_THEME_WIDGET", w.kind);
  themeRevalidate();
  return { ok: true };
}

export type SidebarWidgetPatch = { id: string; title?: string | null; enabled?: boolean; config?: unknown };

export async function updateSidebarWidgetAction(patch: SidebarWidgetPatch): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const theme = await readThemeDoc();
  const idx = theme.sidebar.widgets.findIndex((x) => x.id === patch.id);
  if (idx < 0) return { ok: false, error: "组件不存在" };
  const widget = theme.sidebar.widgets[idx];

  if (patch.title !== undefined) widget.title = cleanTitle(patch.title);
  if (patch.enabled !== undefined) widget.enabled = patch.enabled;
  if (patch.config !== undefined) {
    const v = safeSidebarConfig(widget.kind, patch.config);
    if (!v.ok) return { ok: false, error: v.error };
    widget.config = v.data as SidebarWidgetConfig;
  }
  theme.sidebar.widgets[idx] = widget;
  await writeThemeDoc(theme);
  await audit(admin.id, "EDIT_THEME_WIDGET", widget.kind);
  themeRevalidate();
  return { ok: true };
}

/** 保存 widget 顺序（ids 为最终顺序） */
export async function reorderSidebarWidgetsAction(ids: string[]): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const theme = await readThemeDoc();
  const map = new Map(theme.sidebar.widgets.map((w) => [w.id, w]));
  const next: SidebarWidget[] = [];
  for (const id of ids) {
    const w = map.get(id);
    if (w) next.push(w);
  }
  for (const w of theme.sidebar.widgets) if (!next.includes(w)) next.push(w);
  theme.sidebar.widgets = next;
  await writeThemeDoc(theme);
  await audit(admin.id, "REORDER_THEME_WIDGET", ids.join(","));
  themeRevalidate();
  return { ok: true };
}

// ---------- 详情页模板默认 ----------

export async function setDetailTemplateAction(patch: {
  scope: "default" | ContentType;
  value: DetailTemplateId;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (patch.scope !== "default" && patch.scope !== "IMAGE" && patch.scope !== "GAME" && patch.scope !== "ARTICLE")
    return { ok: false, error: "作用域不合法" };

  const theme = await readThemeDoc();
  if (patch.scope === "default") theme.detailTemplate.default = patch.value;
  else theme.detailTemplate.byType[patch.scope] = patch.value;
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
