"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { totalPagesOf, type PagingMeta } from "./comment-types";

/**
 * 评论区分页器。
 *
 * 纯文字形态：页码与翻页都是无边框、无背景、无内距的文字按钮，靠间距和颜色区分，
 * 当前页用品牌色 + 中等字重。评论区主体是内容，分页器只该是脚注，不该有一圈方块。
 * 与后台 <Pager> 的区别是这里走客户端异步取数（服务端组件翻页要整页刷新、
 * 会打掉正在输入的回复框），所以用 Button 而不是 Link。
 */

/** 无边框文字按钮：靠 h-6 保底点击区，不加任何内距 */
const BTN_BASE =
  "inline-flex h-6 items-center justify-center text-xs transition focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:text-neutral-300";
const BTN_IDLE = `${BTN_BASE} text-neutral-600 hover:text-brand-700`;
const BTN_CUR = `${BTN_BASE} font-medium text-brand-700`;

const META = "text-xs text-neutral-400";
/** 超过这个页数就折叠中间的页码 */
const MAX_PLAIN_PAGES = 7;

/** 页数多时折叠：首末页与当前页 ±1 常驻，跳段处用省略号 */
function pageItems(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= MAX_PLAIN_PAGES) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const marks = [...new Set([1, totalPages, page - 1, page, page + 1])]
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const p of marks) {
    if (prev && p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

function PageBar({
  paging,
  pending,
  onChange,
  label,
}: {
  paging: PagingMeta;
  pending: boolean;
  onChange: (page: number) => void;
  label: string;
}) {
  const totalPages = totalPagesOf(paging);
  return (
    <div className="flex items-center gap-2.5" role="group" aria-label={label} aria-busy={pending}>
      <Button
        type="button"
        disabled={paging.page <= 1 || pending}
        onClick={() => onChange(paging.page - 1)}
        aria-label="上一页"
        className={BTN_IDLE}
      >
        <ChevronLeft size={14} aria-hidden />
      </Button>
      {pageItems(paging.page, totalPages).map((it, i) =>
        it === "gap" ? (
          <span key={`gap-${i}`} aria-hidden className="text-xs text-neutral-400">
            …
          </span>
        ) : (
          <Button
            key={it}
            type="button"
            disabled={pending}
            onClick={() => onChange(it)}
            aria-label={`第 ${it} 页`}
            aria-current={it === paging.page ? "page" : undefined}
            className={it === paging.page ? BTN_CUR : BTN_IDLE}
          >
            {it}
          </Button>
        ),
      )}
      <Button
        type="button"
        disabled={paging.page >= totalPages || pending}
        onClick={() => onChange(paging.page + 1)}
        aria-label="下一页"
        className={BTN_IDLE}
      >
        <ChevronRight size={14} aria-hidden />
      </Button>
    </div>
  );
}

/** 根楼层分页器：翻页替换整页内容 */
export function CommentsPager({
  paging,
  commentTotal,
  pending,
  onChange,
}: {
  paging: PagingMeta;
  /** 含楼中楼的评论总数，与标题「评论（N）」同口径 */
  commentTotal: number;
  pending: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <nav
      aria-label="评论分页"
      className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4"
    >
      <p className={META}>
        共 {commentTotal} 条评论
        {pending && (
          <span role="status" className="ml-2">
            加载中…
          </span>
        )}
      </p>
      <PageBar paging={paging} pending={pending} onChange={onChange} label="评论页码" />
    </nav>
  );
}

/** 子评论分页器：贴在某个根楼层的回复列表下方，与回复列表同一条缩进基线 */
export function RepliesPager({
  paging,
  pending,
  onChange,
}: {
  paging: PagingMeta;
  pending: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <div className="ml-10 mt-3 flex flex-wrap items-center gap-3 border-l-2 border-neutral-100 pl-4">
      <span className={META}>
        共 {paging.total} 条回复
        {pending && (
          <span role="status" className="ml-2">
            加载中…
          </span>
        )}
      </span>
      <PageBar paging={paging} pending={pending} onChange={onChange} label="回复页码" />
    </div>
  );
}
