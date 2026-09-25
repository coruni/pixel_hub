"use client";

// 全站统一 Button：按钮样式的唯一入口。
//
// 字典本身住在 @/lib/ui/button-variants（非 client 模块），这样 <Button>、
// <ButtonLink> 和服务端组件能共用同一份定义，不会各自再抄一遍 class 串。
//
// 为什么是「色调 × 尺寸」两轴：改造前 224 处调用里只有 20 处用了 variant，其余 204 处
// 把 class 串塞进 className，共 132 种写法，其中大量是「同色调不同尺寸」或「同尺寸差
// 一个 transition」的近似重复。平铺变体表达不了这两个正交维度，只会把重复从调用点
// 搬进字典，所以这里拆成两轴组合。
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { buttonClass, type ButtonSize, type ButtonTone } from "@/lib/ui/button-variants";

export type { ButtonSize, ButtonTone };

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonTone;
  size?: ButtonSize;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, className, ...rest },
  ref,
) {
  return <button ref={ref} className={buttonClass(variant, size, className) || undefined} {...rest} />;
});
