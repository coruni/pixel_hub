"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  ChevronDown,
  ClipboardCheck,
  CreditCard,
  FileText,
  Flag,
  FolderOpen,
  FolderTree,
  HardDrive,
  Images,
  LayoutDashboard,
  Menu,
  PanelsTopLeft,
  ReceiptText,
  ScrollText,
  Settings2,
  Sparkles,
  Tag,
  Upload,
  Users,
  Wallet,
  X,
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

/** 移动端面板的 id，供触发按钮的 aria-controls 指向 */
const PANEL_ID = "admin-nav-panel";

const isActive = (pathname: string, href: string) =>
  href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

/**
 * 后台侧栏导航。
 *
 * - `lg` 及以上：常驻左栏，按业务分组竖排并 sticky 跟随滚动。
 * - `lg` 以下：收成一个折叠入口（显示当前所在页），点开是导航条下方的覆盖式面板。
 *   改造前窄屏是「每个分组各自一条横向滚动条」——5 条并列要吃掉约 300px 首屏高度、
 *   每个分组的后半段默认不可见（要单独横滑才知道有），且行高 36px 低于 44px 触控下限。
 */
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
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  const sections = (groups ?? [{ label: "", items: tabs ?? [] }])
    .map((g) => ({ label: g.label, items: g.items.filter((t) => !t.adminOnly || isAdmin) }))
    .filter((g) => g.items.length > 0);

  const current = sections.flatMap((g) => g.items).find((t) => isActive(pathname, t.href));

  // 打开时：锁滚动 + Esc 关闭 + 跨到 lg 立即收起
  // （跨断点必须主动收：面板被 lg:hidden 藏掉后，body 会一直挂着 overflow:hidden）
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const mq = window.matchMedia("(min-width: 1024px)");
    const onBreakpoint = () => {
      if (mq.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onBreakpoint);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onBreakpoint);
    };
  }, [open]);

  // 打开时把当前页滚进面板可视区（19 个入口，当前项常在首屏之外）。
  // 只改面板自身的 scrollTop，不用 scrollIntoView —— 后者会连带滚动被锁住的文档。
  useEffect(() => {
    const panel = panelRef.current;
    const el = activeRef.current;
    if (!open || !panel || !el || panel.clientHeight === 0) return;
    panel.scrollTop = Math.max(0, el.offsetTop - panel.clientHeight / 2 + el.clientHeight / 2);
  }, [open]);

  return (
    <>
      {/* ---------- 窄屏：折叠入口 ---------- */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={open ? PANEL_ID : undefined}
          className="flex min-h-11 w-full items-center gap-2 rounded-none border border-brand-200 bg-surface px-3 text-left text-sm text-neutral-700 transition hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <Menu size={16} className="shrink-0 text-neutral-400" aria-hidden />
          <span className="min-w-0 truncate">
            后台菜单
            {current && <span className="text-neutral-400"> · {current.label}</span>}
          </span>
          <ChevronDown
            size={16}
            className={`ml-auto shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      </div>

      {/* ---------- 窄屏：覆盖式面板（含遮罩，点遮罩/链接/Esc 均可收起） ---------- */}
      {open && (
        <>
          <div
            className="fixed inset-x-0 bottom-0 top-16 z-40 bg-black/40 lg:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            id={PANEL_ID}
            ref={panelRef}
            className="fixed inset-x-0 top-16 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-brand-200 bg-panel shadow-lg lg:hidden"
          >
            <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold tracking-[0.16em] text-neutral-500">
                  管理菜单
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭菜单"
                  className="-mr-3 grid h-11 w-11 shrink-0 place-items-center rounded-none text-neutral-500 transition hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <X size={18} aria-hidden />
                </button>
              </div>
              <nav aria-label="后台导航" className="grid gap-3">
                {sections.map((group, groupIndex) => (
                  <div
                    key={group.label || groupIndex}
                    className={groupIndex > 0 ? "border-t border-brand-100 pt-3" : ""}
                  >
                    {group.label && (
                      <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
                        {group.label}
                      </p>
                    )}
                    <div className="grid gap-0.5">
                      {group.items.map((t) => (
                        <TabLink
                          key={t.href}
                          tab={t}
                          active={isActive(pathname, t.href)}
                          iconSize={16}
                          className="min-h-11 gap-2.5 px-3"
                          onClick={() => setOpen(false)}
                          activeRef={isActive(pathname, t.href) ? activeRef : undefined}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </nav>
            </div>
          </div>
        </>
      )}

      {/* ---------- lg 及以上：常驻竖排侧栏 ---------- */}
      <nav aria-label="后台导航" className="hidden lg:sticky lg:top-20 lg:block">
        {sections.map((group, groupIndex) => (
          <div key={group.label || groupIndex} className={groupIndex > 0 ? "mt-4" : ""}>
            {group.label && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
                {group.label}
              </p>
            )}
            <div className="grid gap-0.5">
              {group.items.map((t) => (
                <TabLink
                  key={t.href}
                  tab={t}
                  active={isActive(pathname, t.href)}
                  iconSize={15}
                  className="gap-2 px-3 py-2"
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
}

/** 单个入口：窄屏与桌面共用一套激活/悬浮/焦点样式，只在盒模型上分叉 */
function TabLink({
  tab,
  active,
  iconSize,
  className,
  onClick,
  activeRef,
}: {
  tab: AdminTab;
  active: boolean;
  iconSize: number;
  className: string;
  onClick?: () => void;
  activeRef?: Ref<HTMLAnchorElement>;
}) {
  const Icon = TAB_ICONS[tab.href];
  return (
    <Link
      href={tab.href}
      onClick={onClick}
      ref={activeRef}
      aria-current={active ? "page" : undefined}
      className={`flex items-center rounded-none text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
        active
          ? "border border-brand-600 bg-brand-500 font-medium text-white"
          : "border border-transparent text-neutral-600 hover:bg-brand-50 hover:text-neutral-900"
      } ${className}`}
    >
      {Icon && (
        <Icon
          size={iconSize}
          className={`shrink-0 ${active ? "text-white/90" : "text-neutral-400"}`}
          aria-hidden
        />
      )}
      <span className="min-w-0 truncate">{tab.label}</span>
    </Link>
  );
}
