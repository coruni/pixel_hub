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

/**
 * 顶部导航行内控件的统一高度：搜索框输入、主题切换、汉堡按钮、头像菜单、注册。
 * 这些控件在 64px 高的导航条里并排，各自 py-* 算出来的高度并不相等（32/34/38/40），
 * 统一改成显式高度后基线才对齐——新增导航控件请一并取这个常量。
 */
export const NAV_CONTROL_H = "h-9";
/** 顶部导航方形图标控件（需与 NAV_CONTROL_H 同高，宽度取 9 保持正方形） */
export const NAV_ICON_BTN = `grid ${NAV_CONTROL_H} w-9 place-items-center`;

/** 主按钮（小尺寸，后台操作） */
export const BTN_PRIMARY_SM =
  "inline-flex items-center gap-1 rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50";
/** 幽灵按钮（小尺寸） */
export const BTN_GHOST_SM =
  "inline-flex items-center gap-1 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 transition hover:border-brand-400 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50";
/** 危险按钮（小尺寸，删除/封禁类确认操作） */
export const BTN_DANGER_SM =
  "inline-flex items-center gap-1 rounded-none border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50";

/**
 * 详情页操作条的文字化动作项（点赞/收藏/举报/编辑）。
 * 去掉 border/bg/图标，只留文字；整条操作压成一行，靠颜色 + 文案（「点赞」↔「已赞」）表达状态，
 * 保底高度 32px（py-1.5 + text-sm）满足 WCAG 2.5.8 的 24px 触控下限。
 */
export const ACTION_TEXT =
  "inline-flex items-center rounded-none py-1.5 text-sm text-neutral-500 transition hover:text-neutral-900 focus-visible:underline disabled:opacity-60";
