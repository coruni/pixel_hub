// 按钮变体样式的单一事实来源。
//
// 这里刻意【不加 "use client"】：<Button>（客户端组件）与 <ButtonLink>（服务端可用的
// <Link> 包装）都要消费同一份字典，任何带 "use client" 的模块都无法被服务端组件
// 安全复用。className 纯字符串，跨边界没有额外成本。
//
// 改造前的问题：全站 224 处 <Button> 里 204 处把 class 串直接塞进 className，
// 共出现 132 种写法；另有 19 个文件各自定义本地按钮常量（BTN_CANCEL/submitBtn/
// iconBtn/baseBtn/OK…）。同一套品牌实底样式被抄写了十几遍，改一处颜色要改十几个文件。
import { ACTION_TEXT } from "@/lib/ui/cls";

/** 色调：颜色语义 */
export type ButtonTone =
  /** 品牌实底 · 全站主操作 */
  | "primary"
  /** 品牌实底 · 深阶（弹层确认，白字对比度更稳） */
  | "primaryDark"
  /** 描边幽灵 · 次要操作 / 取消 */
  | "ghost"
  /** 危险描边 · 浅底红字（删除/下架） */
  | "danger"
  /** 静默危险 · 中性底、悬浮才转红（移除头像/背景等低频破坏性操作） */
  | "dangerGhost"
  /** 危险实底 · 强制确认 */
  | "dangerSolid"
  /** 成功实底 · 通过/下载 */
  | "success"
  /** 警告描边 · 待处理/需注意 */
  | "warn"
  /** 后台列表页筛选提交 */
  | "filter"
  /** 无边框文字按钮 · 次级取消（悬浮只变底色，不变文字色） */
  | "plain"
  /** 纯文字动作项（点赞/收藏/打赏），与详情页 <Link> 共用 ACTION_TEXT */
  | "action";

/** 尺寸：内距 + 字号 + 字重 */
export type ButtonSize =
  /** 超紧 · 单行元数据区 */
  | "xs"
  /** 紧凑 · 后台密集操作（默认） */
  | "sm"
  /** 常规 · 正文/表单提交 */
  | "md"
  /** 整宽提交 · 登录注册族 */
  | "block";

/** 所有矩形按钮的公共骨架：直角、弹性居中行、过渡与焦点环、禁用态 */
export const BUTTON_BASE =
  "inline-flex items-center gap-1.5 justify-center rounded-none transition focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50";

export const BUTTON_TONES: Record<ButtonTone, string> = {
  primary: "border border-brand-600 bg-brand-500 text-white hover:bg-brand-600",
  primaryDark: "border border-brand-700 bg-brand-600 text-white hover:bg-brand-700",
  ghost:
    "border border-brand-200 bg-surface text-neutral-600 hover:border-brand-400 hover:text-brand-700",
  danger: "border border-red-300 text-red-600 hover:bg-red-50",
  dangerGhost:
    "border border-brand-200 bg-surface text-neutral-600 hover:border-red-300 hover:text-red-600",
  dangerSolid: "border border-red-600 bg-red-600 text-white hover:bg-red-500",
  success: "border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500",
  warn: "border border-amber-400 bg-amber-100 text-amber-800 hover:bg-amber-200",
  filter: "border border-brand-200 bg-surface text-neutral-700 hover:border-brand-500",
  plain: "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800",
  // action 自带尺寸与 focus-visible:underline，不叠加 BUTTON_BASE
  action: ACTION_TEXT,
};

export const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: "px-3 py-1 text-xs font-medium",
  sm: "px-3 py-1.5 text-xs font-medium",
  md: "px-4 py-1.5 text-sm font-medium",
  block: "w-full px-4 py-2.5 text-sm font-medium",
};

/**
 * 拼装最终 class。
 * - 不传 tone：只输出 className，留给「一次性特化」调用点（图片预览叠加层、画廊箭头、
 *   播放器控件等），它们有独立视觉族，不接受通用色调；
 * - tone="action"：整串替换为 ACTION_TEXT，不参与尺寸轴。
 */
export function buttonClass(
  tone?: ButtonTone,
  size: ButtonSize = "sm",
  className?: string,
): string {
  const base = !tone
    ? ""
    : tone === "action"
      ? BUTTON_TONES.action
      : `${BUTTON_BASE} ${BUTTON_TONES[tone]} ${BUTTON_SIZES[size]}`;
  return (className ? `${base} ${className}` : base).trim();
}
