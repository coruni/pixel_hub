"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

// 通知卡外层跳转容器：卡内已有 @用户名 Link / 删除按钮等交互元素，
// HTML 不允许 <a> 嵌套 <a>（会 hydration 报错），改为 div + 编程式导航；
// 点击内部 a/button 时由其自身处理，不触发外层跳转。
export default function NotificationCardLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <div
      role="link"
      tabIndex={0}
      className={className}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        router.push(href);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.target as HTMLElement).closest("a,button")) router.push(href);
      }}
    >
      {children}
    </div>
  );
}
