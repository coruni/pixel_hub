"use client";

// 登录用户在线心跳：挂 root layout，每 60s sendBeacon /api/presence 刷新 lastSeenAt。
// 页面隐藏时暂停（visibilitychange），回到前台立即补一次。
import { useEffect } from "react";
import { PRESENCE_INTERVAL_MS } from "@/lib/online";

export default function PresencePing({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    if (!signedIn) return;

    function ping() {
      if (document.visibilityState !== "visible") return;
      try {
        navigator.sendBeacon("/api/presence", "");
      } catch {
        // 忽略：beacon 不可用或被节流
      }
    }

    const timer = setInterval(ping, PRESENCE_INTERVAL_MS);
    document.addEventListener("visibilitychange", ping);
    ping(); // 挂载即报一次
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [signedIn]);

  return null;
}
