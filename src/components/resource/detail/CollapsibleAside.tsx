"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * 详情页双栏布局：左内容 + 340px 侧栏。
 * 桌面（lg+）：把手贴在两栏交界上缘，收起时左列占满整行（轨道宽度和 gap 过渡）。
 * 移动端：单列堆叠，面板始终展示（不提供收起）。
 */
export default function CollapsibleAside({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <div
      className={`relative mt-6 grid grid-cols-1 transition-[grid-template-columns,gap] duration-300 ease-in-out ${
        open ? "lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6" : "lg:grid-cols-[minmax(0,1fr)_0px] lg:gap-0"
      }`}
    >
      <div className="min-w-0 space-y-5">{main}</div>

      <aside className="mt-6 min-w-0 space-y-4 overflow-hidden lg:mt-0">{aside}</aside>

      {/* 桌面把手 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "收起信息面板" : "展开信息面板"}
        title={open ? "收起信息面板" : "展开信息面板"}
        className="absolute top-0 z-20 hidden h-9 w-6 items-center justify-center rounded-none border border-brand-200 bg-surface text-neutral-500 shadow-none transition-[right] duration-300 ease-in-out hover:border-brand-500 hover:text-brand-600 lg:flex"
        style={{ right: open ? "340px" : "0px" }}
      >
        {open ? <ChevronRight size={14} aria-hidden /> : <ChevronLeft size={14} aria-hidden />}
      </button>
    </div>
  );
}
