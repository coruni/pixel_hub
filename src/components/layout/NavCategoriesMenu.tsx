"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LayoutGrid } from "lucide-react";

export type NavCategory = { slug: string; name: string };

/** 顶部导航「分类」下拉菜单：点击展开分类直达（移动端同样可用），Esc/点击外部关闭 */
export default function NavCategoriesMenu({
  label,
  items,
}: {
  label: string;
  items: NavCategory[];
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-neutral-600 transition hover:text-neutral-900"
      >
        <LayoutGrid size={15} aria-hidden />
        {label}
        <ChevronDown
          size={13}
          className={`text-neutral-400 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+10px)] z-50 w-56 overflow-hidden rounded-none border border-brand-200 bg-surface p-1.5"
        >
          <ul className="grid gap-0.5 sm:grid-cols-1">
            {items.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/browse?cat=${c.slug}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-none px-3 py-1.5 text-sm text-neutral-700 transition hover:bg-brand-50 hover:text-neutral-900"
                >
                  <span className="truncate">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
