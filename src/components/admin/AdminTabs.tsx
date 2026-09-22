"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  ClipboardCheck,
  CreditCard,
  FileText,
  Flag,
  FolderOpen,
  FolderTree,
  HardDrive,
  Images,
  LayoutDashboard,
  PanelsTopLeft,
  ReceiptText,
  ScrollText,
  Settings2,
  Sparkles,
  Tag,
  Upload,
  Users,
  Wallet,
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
  "/admin/site": PanelsTopLeft,
  "/admin/docs": FileText,
  "/admin/runtime": Settings2,
  "/admin/categories": FolderTree,
  "/admin/tags": Tag,
  "/admin/media": Images,
  "/admin/drives": HardDrive,
  "/admin/uploads": Upload,
  "/admin/incentive": Sparkles,
  "/admin/settlement": ReceiptText,
  "/admin/withdrawals": Wallet,
  "/admin/finance": BadgeDollarSign,
  "/admin/payment": CreditCard,
};

/** 后台侧栏导航：桌面左侧竖排（sticky），移动端横向滚动；当前路由橙色高亮 */
export default function AdminTabs({ tabs, isAdmin }: { tabs: AdminTab[]; isAdmin: boolean }) {
  const pathname = usePathname();
  const list = tabs.filter((t) => !t.adminOnly || isAdmin);
  return (
    <nav className="flex w-full min-w-0 gap-1.5 overflow-x-auto pb-2 lg:sticky lg:top-20 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
      {list.map((t) => {
        const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        const Icon = TAB_ICONS[t.href];
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex items-center gap-2 rounded-none px-3 py-2 text-sm ${
              // 移动端横向滚动：不能被压缩，否则文字被挤成竖排
              "shrink-0 lg:shrink"
            } ${
              active
                ? "border border-brand-600 bg-brand-500 font-medium text-white"
                : "text-neutral-600 transition hover:bg-brand-50 hover:text-neutral-900"
            }`}
          >
            {Icon && (
              <Icon
                size={15}
                className={`shrink-0 ${active ? "text-white/90" : "text-neutral-400"}`}
                aria-hidden
              />
            )}
            {/* 桌面窄栏（lg:w-48）容纳不下时省略而不是撑破容器 */}
            <span className="min-w-0 truncate">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
