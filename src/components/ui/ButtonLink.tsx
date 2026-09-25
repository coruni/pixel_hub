// <Link> 形态的按钮：与 <Button> 共用同一份变体字典。
//
// 存在的理由：站内有多处「看起来是按钮、语义上是链接」的入口（详情页登录后编辑、
// 后台保存后的返回）。改造前它们各自 `className={BTN_GHOST_SM}` 或 `className={ACTION_TEXT}`，
// 于是按钮样式又多了一份拷贝。这里让它和 <Button> 走同一套色调 × 尺寸。
//
// 不带 "use client"：不需要浏览器状态，服务端组件也能直接渲染。
import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonClass, type ButtonSize, type ButtonTone } from "@/lib/ui/button-variants";

export type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonTone;
  size?: ButtonSize;
};

export function ButtonLink({ variant, size, className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, className) || undefined} {...rest} />;
}
