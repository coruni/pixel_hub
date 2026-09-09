"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutGrid, Menu, X } from "lucide-react";
import { NAV_ICON_MAP } from "@/lib/nav-icons";
import type { NavCategory } from "./NavCategoriesMenu";
import { Button } from "@/components/ui/Button";

export type MobileNavItem = {
  id: string;
  label: string;
  href: string;
  newTab: boolean;
  icon: string;
};

/** 小屏导航抽屉（<sm 显示）：汉堡按钮 + 全屏下滑面板，含导航项与分类直达 */
export default function MobileNav({
  items,
  catLabel,
  categories,
}: {
  items: MobileNavItem[];
  catLabel: string;
  categories: NavCategory[];
}) {
  const [open, setOpen] = useState(false);

  // 打开时锁滚动 + Esc 关闭
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // 点击任意链接立即收起：不能依赖 usePathname——
  // 点当前页链接或仅 searchParams 变化（/browse?cat=a → ?cat=b）时 pathname 不变，
  // 抽屉不关、body 保持锁滚动，页面表现为「点击无反应」
  const close = () => setOpen(false);

  return (
    <div className="sm:hidden">
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="打开导航菜单"
        aria-expanded={open}
        className="grid h-8 w-8 place-items-center rounded-none border border-brand-200 bg-surface text-neutral-700 transition hover:border-brand-500"
      >
        {open ? <X size={16} /> : <Menu size={16} />}
      </Button>

      {open && (
        <div className="fixed inset-x-0 top-16 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-brand-200 bg-surface shadow-lg">
          <nav className="mx-auto grid max-w-7xl gap-1 px-4 py-4">
            {items.map((it) => {
              const Icon = it.icon ? NAV_ICON_MAP[it.icon] : null;
              return (
                <Link
                  key={it.id}
                  href={it.href}
                  onClick={close}
                  target={it.newTab ? "_blank" : undefined}
                  rel={it.newTab ? "noopener noreferrer" : undefined}
                  className="flex items-center gap-3 rounded-none px-3 py-2.5 text-sm text-neutral-700 transition hover:bg-brand-50 hover:text-neutral-900"
                >
                  {Icon && <Icon size={16} aria-hidden />}
                  {it.label}
                </Link>
              );
            })}

            {categories.length > 0 && (
              <div className="mt-2 border-t border-brand-100 pt-3">
                <p className="flex items-center gap-2 px-3 pb-2 text-xs font-medium text-neutral-400">
                  <LayoutGrid size={13} aria-hidden />
                  {catLabel}
                </p>
                <ul className="grid grid-cols-2 gap-1">
                  {categories.map((c) => (
                    <li key={c.slug}>
                      <Link
                        href={`/browse?cat=${c.slug}`}
                        onClick={close}
                        className="block truncate rounded-none px-3 py-2 text-sm text-neutral-600 transition hover:bg-brand-50 hover:text-neutral-900"
                      >
                        {c.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
