// 后台统一数据表格 token：直角像素语言（rounded-none）+ 品牌边框 + 中性分隔线。
// 分类、标签、媒体、用户、日志等后台表格统一复用，避免风格漂移。
// 仅导出 class 常量，服务端组件可直接引用；勾选框见 SquareCheckbox.tsx。

import type { ReactNode } from "react";
import { PageSizeSelect } from "./PageSizeSelect";
import { Pager } from "./Pager";

export const TABLE_WRAP = "overflow-x-auto rounded-none border border-brand-200 bg-surface";
export const TABLE = "w-full text-sm";
export const THEAD_ROW = "border-b border-neutral-100 text-left text-xs text-neutral-400";
export const TH = "px-4 py-2.5 font-medium";
export const TH_RIGHT = "px-4 py-2.5 text-right font-medium";
export const TROW = "border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50/60";
export const TD = "px-4 py-2.5 align-middle";
export const TD_RIGHT = "px-4 py-2.5 text-right align-middle";

/** 勾选框列：紧凑内边距 + 居中，避免 16px 勾选框被 w-* 列宽与 px-4 边距挤压 */
export const TH_CHECK = "w-11 px-3 py-2.5 text-center font-medium";
export const TD_CHECK = "w-11 px-3 py-2.5 text-center align-middle";

/** 表格底部分页/操作条容器：与 Pager 间距一致，避免各页各写一套 */
export const TABLE_FOOT = "mt-4 flex flex-wrap items-center justify-between gap-3";

/**
 * 表格空状态行：跨整表居中提示，保持骨架稳定（无横向跳变、无空白塌陷）。
 * 默认文案「暂无数据」，调用方可覆盖（如「没有匹配的标签」）。
 */
export function EmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children?: ReactNode;
}) {
  return (
    <tr>
      <td className={`${TD} text-center text-neutral-400`} colSpan={colSpan}>
        {children ?? "暂无数据"}
      </td>
    </tr>
  );
}

/**
 * 表格底部分页条：左侧「每页条数」选择（pageSize 切换），右侧总数与翻页。
 * 后台所有数据表格页统一使用，保证 pageSize 控件位置一致（底部左下角）。
 */
export function TableFooter({
  page,
  hasMore,
  total,
  pageSize,
  href,
  options,
}: {
  page: number;
  hasMore: boolean;
  total: number;
  pageSize: number;
  href: (p: number) => string;
  options?: number[];
}) {
  return (
    <div className={TABLE_FOOT}>
      <PageSizeSelect pageSize={pageSize} options={options} />
      <Pager page={page} hasMore={hasMore} total={total} pageSize={pageSize} href={href} />
    </div>
  );
}
