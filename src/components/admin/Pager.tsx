import Link from "next/link";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/paging";
import { formatCount } from "@/lib/format";

const LINK =
  "rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-neutral-900";
// 禁用态仍占位：翻到首页/末页时不发生布局跳变
const OFF = "rounded-none border border-neutral-100 bg-surface px-3 py-1.5 text-xs text-neutral-300";

/**
 * 后台列表分页条：显示总数与当前区间，翻页链接由调用方用筛选参数拼出。
 * hasMore 用「多取一条」判定，避免为算总页数再查一次库。
 */
export function Pager({
  page,
  hasMore,
  total,
  pageSize = ADMIN_PAGE_SIZE,
  href,
}: {
  page: number;
  hasMore: boolean;
  total: number;
  pageSize?: number;
  href: (p: number) => string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-xs text-neutral-400">
        共 {formatCount(total)} 条 · 第 {page} 页（{from}–{to}）
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={LINK}>
            上一页
          </Link>
        ) : (
          <span className={OFF} aria-disabled="true">
            上一页
          </span>
        )}
        {hasMore ? (
          <Link href={href(page + 1)} className={LINK}>
            下一页
          </Link>
        ) : (
          <span className={OFF} aria-disabled="true">
            下一页
          </span>
        )}
      </div>
    </div>
  );
}
