// 共享 class 常量：全站反复出现的按钮/输入框/卡片样式收敛于此（rounded-none 直角设计语言）。
// 用法：className={`${BTN_PRIMARY_SM}`}，需要叠加尺寸/颜色微调时再拼额外类。

/** 表单输入框（全宽） */
export const INPUT =
  "w-full rounded-none border border-brand-200 bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand-500";
/** 表单输入框（紧凑，后台行内编辑用） */
export const INPUT_SM =
  "rounded-none border border-brand-200 bg-surface px-2.5 py-1.5 text-sm outline-none transition focus:border-brand-500";
/** 表单 label（编辑器内强调样式） */
export const LABEL_STRONG = "mb-1 block text-xs font-medium text-neutral-500";
/** 下拉选择框（紧凑，后台筛选/合并等） */
export const SELECT_SM =
  "rounded-none border border-brand-200 bg-surface px-2 py-1.5 text-sm outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-400";

/** 后台列表页筛选输入框/下拉（与既有列表页统一：px-3 py-1.5 text-xs + 焦点环） */
export const INPUT_FILTER =
  "rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-400";
/** 后台列表页筛选提交按钮（ghost 风格，全后台列表页统一） */
export const BTN_FILTER =
  "rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-400";

/** 主按钮（小尺寸，后台操作） */
export const BTN_PRIMARY_SM =
  "inline-flex items-center gap-1 rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50";
/** 幽灵按钮（小尺寸） */
export const BTN_GHOST_SM =
  "inline-flex items-center gap-1 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 transition hover:border-brand-400 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50";
/** 危险按钮（小尺寸，删除/封禁类确认操作） */
export const BTN_DANGER_SM =
  "inline-flex items-center gap-1 rounded-none border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50";
