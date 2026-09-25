"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  connectedSnapshot,
  onMessage,
  presenceOf,
  subscribeRoom,
  subscribeStore,
  unreadSnapshot,
  watchUsers,
} from "./client";
import type { ServerMessage } from "./protocol";

/** 实时通道是否已连上；false 时各消费方走低频兜底轮询 */
export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(subscribeStore, connectedSnapshot, () => false);
}

/** 实时未读数；null 表示还没有权威值，调用方沿用服务端渲染的初值 */
export function useUnreadCount(): number | null {
  return useSyncExternalStore(subscribeStore, unreadSnapshot, () => null);
}

/** 订阅服务端推送。回调放 ref，避免每次渲染都重新注册。 */
export function useRealtimeMessages(handler: (msg: ServerMessage) => void): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => onMessage((msg) => ref.current(msg)), []);
}

/** 订阅一个公开房间（传 null 表示暂不订阅） */
export function useRealtimeRoom(room: string | null): void {
  useEffect(() => {
    if (!room) return;
    return subscribeRoom(room);
  }, [room]);
}

/**
 * 关注一组用户的在线状态。
 * ids 每次渲染都是新数组，先归一成排序去重后的字符串再作依赖，避免每帧重订阅。
 */
export function usePresenceWatch(ids: string[]): void {
  const key = normalizedKey(ids);
  useEffect(() => {
    if (!key) return;
    return watchUsers(key.split(","));
  }, [key]);
}

/**
 * 在线状态：WS 有明确结论就用它，否则回落服务端渲染的值。
 * 快照返回布尔原始值 —— 值不变时 React 直接跳过重渲染，不会因他人上下线而整页刷新。
 */
export function useLiveOnline(userId: string | null | undefined, fallback: boolean): boolean {
  const getSnapshot = useCallback(() => {
    if (!userId) return fallback;
    const live = presenceOf(userId);
    return live === undefined ? fallback : live;
  }, [userId, fallback]);
  return useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot);
}

function normalizedKey(ids: string[]): string {
  const set = new Set<string>();
  for (const id of ids) if (typeof id === "string" && id) set.add(id);
  return [...set].sort().join(",");
}
