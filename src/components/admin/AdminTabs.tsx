"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  Flag,
  FolderOpen,
  FolderTree,
  HardDrive,
  Images,
  LayoutDashboard,
  LayoutTemplate,
  PanelsTopLeft,
  ScrollText,
  Tag,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

export type AdminTab = { href: string; label: string; adminOnly?: boolean };

const TAB_ICONS: Record<string, LucideIcon> = {
  "/admin": LayoutDashboard,
  "/admin/queue": ClipboardCheck,
  "/admin/content": FolderOpen,
  "/admin/reports": Flag,
  "/admin/users": Users,
  "/admin/logs": ScrollText,
  "/admin/home": LayoutTemplate,
  "/admin/site": PanelsTopLeft,
  "/admin/categories": FolderTree,
  "/admin/tags": Tag,
  "/admin/media": Images,
  "/admin/drives": HardDrive,
  "/admin/uploads": Upload,
};

/** 后台侧栏导航：桌面左侧竖排（sticky），移动端横向滚动；当前路由橙色高亮 */
export default function AdminTabs({ tabs, isAdmin }: { tabs: AdminTab[]; isAdmin: boolean }) {
  const pathname = usePathname();
  const list = tabs.filter((t) => !t.adminOnly || isAdmin);
  return (
    <nav className="flex gap-1.5 overflow-x-auto pb-2 lg:sticky lg:top-20 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
      {list.map((t) => {
        const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        const Icon = TAB_ICONS[t.href];
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              active
                ? "flex shrink-0 items-center gap-2 rounded-none border border-brand-600 bg-brand-500 px-3 py-2 text-sm font-medium text-white"
                : "flex shrink-0 items-center gap-2 rounded-none px-3 py-2 text-sm text-neutral-600 transition hover:bg-brand-50 hover:text-neutral-900"
            }
          >
            {Icon && (
              <Icon
                size={15}
                className={active ? "text-white/90" : "text-neutral-400"}
                aria-hidden
              />
            )}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
