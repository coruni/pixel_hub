"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ReactNode } from "react";
import { markNotificationReadAction } from "@/lib/actions/notify";

// 通知卡外层跳转容器：卡内已有 @用户名 Link / 删除按钮等交互元素，
// HTML 不允许 <a> 嵌套 <a>（会 hydration 报错），改为 div + 编程式导航；
// 点击内部 a/button 时由其自身处理，不触发外层跳转。
export default function NotificationCardLink({
  href,
  id,
  read,
  className,
  children,
}: {
  href: string;
  /** 通知 id：跳转前先标记已读（未读态才请求，已读卡片不产生无谓写操作） */
  id?: string;
  read?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const go = () => {
    // 先标已读再跳转：跳走以后组件已卸载，fire-and-forget 可能被中断导致「点过了仍是未读」
    if (id && !read) {
      startTransition(async () => {
        await markNotificationReadAction(id);
        router.push(href);
      });
      return;
    }
    router.push(href);
  };

  return (
    <div
      role="link"
      tabIndex={0}
      className={className}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        go();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.target as HTMLElement).closest("a,button")) go();
      }}
    >
      {children}
    </div>
  );
}
