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
export type AdminTabGroup = { label: string; items: AdminTab[] };

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

/** 后台侧栏导航：桌面按业务分组竖排（sticky），移动端按分组横向滚动。 */
export default function AdminTabs({
  groups,
  tabs,
  isAdmin,
}: {
  groups?: AdminTabGroup[];
  tabs?: AdminTab[];
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const sections = groups ?? [{ label: "", items: tabs ?? [] }];
  return (
    <nav className="min-w-0 lg:sticky lg:top-20">
      {sections.map((group, groupIndex) => {
        const list = group.items.filter((t) => !t.adminOnly || isAdmin);
        if (list.length === 0) return null;
        return (
          <div key={group.label || groupIndex} className={groupIndex > 0 ? "mt-4" : ""}>
            {group.label && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
                {group.label}
              </p>
            )}
            <div className="flex w-full min-w-0 gap-1.5 overflow-x-auto pb-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
              {list.map((t) => {
                const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
                const Icon = TAB_ICONS[t.href];
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={`flex items-center gap-2 rounded-none px-3 py-2 text-sm shrink-0 lg:shrink ${
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
                    <span className="min-w-0 truncate">{t.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
