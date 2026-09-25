"use client";

// 头像 + 实时在线点。
//
// SSR 给初值（按 lastSeenAt 判定，见 lib/online.ts），WS 连上后由实时连接状态覆盖：
// 断开连接即下线，比 5 分钟窗口更准。实时通道不可用时 useLiveOnline 恒等于 fallback，
// 行为与接入前完全一致。
import type { ComponentProps } from "react";
import Avatar from "./Avatar";
import { useLiveOnline, usePresenceWatch } from "@/lib/realtime/use-realtime";

const NO_IDS: string[] = [];

export default function PresenceAvatar({
  userId,
  online = false,
  ...rest
}: { userId?: string | null; online?: boolean } & Omit<ComponentProps<typeof Avatar>, "online">) {
  // 挂载即关注该作者的在线状态，卸载自动退订；客户端会把同屏多个关注合并成一次 watch 消息
  usePresenceWatch(userId ? [userId] : NO_IDS);
  return <Avatar {...rest} online={useLiveOnline(userId, online)} />;
}
