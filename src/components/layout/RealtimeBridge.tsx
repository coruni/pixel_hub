"use client";

// 实时通道的常驻挂载点（挂在 root layout）。
// 登录用户保持一条常驻连接用于接收通知；游客不占常驻名额，由资源页等处的
// 房间订阅按需拉起连接（见 lib/realtime/client.ts 的按需启停策略）。
import { useEffect } from "react";
import { keepRealtimeAlive } from "@/lib/realtime/client";

export default function RealtimeBridge({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    if (!signedIn) return;
    return keepRealtimeAlive();
  }, [signedIn]);
  return null;
}
