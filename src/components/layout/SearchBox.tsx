"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/**
 * 站内搜索框（全文检索）：提交跳 /search?q=…
 * 桌面导航（Navbar 行内）与移动抽屉（MobileNav）共用，仅宽度与回调不同。
 */
export default function SearchBox({
  onSubmitted,
  className = "",
  placeholder = "搜索…",
}: {
  /** 跳转前回调（移动抽屉用它收起面板） */
  onSubmitted?: () => void;
  className?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState("");

  return (
    <form
      role="search"
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (!q) return;
        onSubmitted?.();
        router.push(`/browse?q=${encodeURIComponent(q)}`);
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        站内搜索
      </label>
      <div className="relative">
        <input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-none border border-brand-200 bg-surface py-2 pl-3 pr-10 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-brand-500"
        />
        <button
          type="submit"
          aria-label="搜索"
          className="absolute inset-y-0 right-0 grid w-10 place-items-center text-neutral-400 transition hover:text-brand-600"
        >
          <Search size={16} aria-hidden />
        </button>
      </div>
    </form>
  );
}
