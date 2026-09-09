"use client";

// 全站统一 Button：把散落的内联 <button className="..."> 收敛为语义变体组件。
//
// 设计原则（重要）：
// - 变体字典中的 class 字符串与改造前各处按钮样式【逐字一致】，替换后 DOM 样式严格不变；
// - 高频模式用 variant 收敛；一次性/条件动态样式用 className 透传兜底（会追加到变体类之后）；
// - disabled/pending/type/onClick 等原生属性原样透传，不拦截 children；
// - 图标按钮（纯 icon、无文字）同样支持：children 照常放 <X size={...}/>。
// - type 语义与原生 <button> 完全一致：省略时不设默认值（表单内默认 submit），
//   替换后不会改变任何提交行为——这是「功能一模一样」的硬约束。
import { forwardRef, type ButtonHTMLAttributes } from "react";
import {
  BTN_DANGER_SM,
  BTN_FILTER,
  BTN_GHOST_SM,
  BTN_PRIMARY_SM,
} from "@/lib/ui/cls";

export type ButtonVariant =
  /** 品牌实底 · 小尺寸（后台行操作/创建类）＝ BTN_PRIMARY_SM */
  | "primary"
  /** 幽灵描边 · 小尺寸（次要操作/取消类）＝ BTN_GHOST_SM */
  | "ghost"
  /** 危险描边 · 小尺寸（删除/下架类）＝ BTN_DANGER_SM */
  | "danger"
  /** 后台列表页筛选提交 ＝ BTN_FILTER */
  | "filter"
  /** 全宽提交（登录/注册/找回/重置密码表单） */
  | "submitFull"
  /** 品牌实底 · 全宽·大号（资源发布/保存主提交） */
  | "submitHero"
  /** 品牌实底 · 常规（设置保存/密码提交） */
  | "submit"
  /** 品牌实底 · 小（正文/内联快捷提交） */
  | "primaryXs"
  /** 幽灵描边 · 无背景（正文内联次要按钮） */
  | "ghostText"
  /** 危险实底 · 小（强制危险操作） */
  | "dangerSolid";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const VARIANTS: Record<ButtonVariant, string> = {
  // —— 高频语义变体（对齐 src/lib/ui/cls.ts 既有常量，逐字一致）——
  primary: BTN_PRIMARY_SM,
  ghost: BTN_GHOST_SM,
  danger: BTN_DANGER_SM,
  filter: BTN_FILTER,

  // —— 内联重复样式收敛（来自各表单现状，逐字一致）——
  // 登录/注册/找回/重置：w-full 主提交
  submitFull:
    "w-full rounded-none border border-brand-600 bg-brand-500 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60",
  // 发布向导 / 后台内容保存：px-8 大字主提交
  submitHero:
    "rounded-none border border-brand-600 bg-brand-500 px-8 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50",
  // 设置保存 / 安全表单提交：px-6 常规主提交
  submit:
    "rounded-none border border-brand-600 bg-brand-500 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50",
  // 首页板块/侧栏组件行内小主按钮
  primaryXs:
    "rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50",
  // 板块/组件行内纯文字取消
  ghostText:
    "rounded-none px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-200 disabled:opacity-50",
  // 举报确权等强制危险实底
  dangerSolid:
    "rounded-none border border-red-600 bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, className, ...rest },
  ref,
) {
  const base = variant ? VARIANTS[variant] : "";
  const cls = className ? `${base} ${className}`.trim() : base;
  return <button ref={ref} className={cls || undefined} {...rest} />;
});
