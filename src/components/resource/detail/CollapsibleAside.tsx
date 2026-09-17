"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * 详情页双栏布局：左内容 + 340px 侧栏。
 * 桌面（lg+）：把手贴在两栏交界上缘，收起时左列占满整行（轨道宽度和 gap 过渡）。
 * 移动端：单列堆叠，面板始终展示（不提供收起）。
 */

/**
 * 侧栏轨道宽度。四处必须同值（展开态轨道、收起态轨道、内层锁定宽度、把手 right 定位），
 * 所以集中在这里；写成完整类名字符串而不是拼接，因为 Tailwind 只能扫到字面量。
 */
const RAIL_OPEN = "lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6";
const RAIL_SHUT = "lg:grid-cols-[minmax(0,1fr)_0px] lg:gap-0";
const RAIL_BOX = "lg:w-[340px]";

export default function CollapsibleAside({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <div
      className={`relative mt-6 grid grid-cols-1 overflow-hidden transition-[grid-template-columns,gap] duration-300 ease-in-out ${
        open ? RAIL_OPEN : RAIL_SHUT
      }`}
    >
      <div className="min-w-0 space-y-5">{main}</div>

      {/* 收起动画会把这一列压到 0，光靠裁剪挡不住高度重排：内容宽度一旦跟着列宽变，
          文本就会逐字折行、卡片高度暴涨，把整个 grid 行撑开（表现为页面高度抖动）。
          解法是内层锁死 340px（与展开态轨道同值），外层只负责裁——内容任何时刻都在
          同一个宽度下排版，高度恒定；收起只是「看不见」，不是「重新排版」。
          whitespace-nowrap 另挡长值（平台串/分类名）在 340px 内折行导致的卡片高度跳动，
          代价是超出部分被硬切：侧栏是概览不是正文，这是刻意取舍。 */}
      <aside className="mt-6 min-w-0 overflow-hidden lg:mt-0">
        <div className={`space-y-4 whitespace-nowrap ${RAIL_BOX}`}>{aside}</div>
      </aside>

      {/* 桌面把手 */}
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "收起信息面板" : "展开信息面板"}
        title={open ? "收起信息面板" : "展开信息面板"}
        className="absolute top-0 z-20 hidden h-9 w-6 items-center justify-center rounded-none border border-brand-200 bg-surface text-neutral-500 shadow-none transition-[right] duration-300 ease-in-out hover:border-brand-500 hover:text-brand-600 lg:flex"
        style={{ right: open ? "340px" : "0px" }}
      >
        {open ? <ChevronRight size={14} aria-hidden /> : <ChevronLeft size={14} aria-hidden />}
      </Button>
    </div>
  );
}
