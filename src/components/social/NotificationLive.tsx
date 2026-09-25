"use client";

// 通知列表的实时同步：收到 notify:changed 就 router.refresh()，不必手动刷新页面。
// 只挂在 /notifications 页面 —— 其它页面由顶部导航的未读角标负责提示（见 UserMenu）。
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeMessages } from "@/lib/realtime/use-realtime";

/** 合并短时间内的多次变化：清空全部通知会连发多条事件，没必要刷好几次 */
const REFRESH_DEBOUNCE_MS = 400;

export default function NotificationLive() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useRealtimeMessages((msg) => {
    if (msg.t !== "notify:changed" || timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
    }, REFRESH_DEBOUNCE_MS);
  });

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return null;
}
