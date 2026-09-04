"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

type Props = {
  /** 板块顶部元素的 id（滚动目标），由服务端在板块外层挂上同 id */
  moduleId: string;
  /** 上一页 href；没有上一页时为 null（隐藏按钮） */
  prevHref: string | null;
  /** 下一页 href；没有下一页时为 null（隐藏按钮） */
  nextHref: string | null;
  page: number;
};

/**
 * 全站浏览等分页流的翻页控件。
 * 点「上一页/下一页」后跳到板块顶部（不是整页顶部、也不是停在原处）：
 * 分页只改 query，板块在文档中的位置不随页号变化，所以在点击当下先把板块滚到顶部，
 * 再用 scroll={false} 让 Next 提交时不覆盖这个位置。
 */
export default function FeedPager({ moduleId, prevHref, nextHref, page }: Props) {
  function goToModuleTop(e: MouseEvent<HTMLAnchorElement>) {
    // 中键/⌘/Ctrl/Shift/Alt 点开新标签等交给浏览器，不在当前页滚动
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    requestAnimationFrame(() => {
      document.getElementById(moduleId)?.scrollIntoView();
    });
  }

  const linkCls = "rounded-none border border-brand-200 px-3 py-1.5 hover:bg-neutral-100";

  return (
    <div className="mt-6 flex items-center justify-center gap-3 text-sm">
      {prevHref && (
        <Link href={prevHref} scroll={false} onClick={goToModuleTop} className={linkCls}>
          上一页
        </Link>
      )}
      <span className="text-xs text-neutral-400">第 {page} 页</span>
      {nextHref && (
        <Link href={nextHref} scroll={false} onClick={goToModuleTop} className={linkCls}>
          下一页
        </Link>
      )}
    </div>
  );
}
