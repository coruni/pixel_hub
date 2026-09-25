"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { roomResource } from "@/lib/realtime/protocol";
import { useRealtimeConnected, useRealtimeMessages, useRealtimeRoom } from "@/lib/realtime/use-realtime";
import type { CommentShape, NewCommentItem } from "./comment-types";

/** WS 在线时的兜底轮询间隔：只用于补漏，正常路径由实时信号触发 */
const FALLBACK_POLL_MS = 60_000;
/** WS 不可用（直接 next dev、代理不支持 upgrade…）时退回原来的轮询节奏 */
const DEGRADED_POLL_MS = 15_000;

/**
 * 评论实时刷新。
 *
 * 实时通道负责「有事发生」的信号（新评论 / 评论结构变化），数据仍由既有的
 * /api/comments 增量端点提供 —— 合并逻辑（楼中楼挂载、删除兜底）只有这一份实现。
 * 实时不可用时自动退回轮询，功能不降级。
 *
 * props 全量覆盖 props 引用变化（发帖/删帖后的 refresh）；服务端删帖由 liveIds 差集兜底触发全量刷新。
 */
export function useCommentPolling(resourceId: string, comments: CommentShape[]) {
  const router = useRouter();
  const connected = useRealtimeConnected();
  // liveComments 初值直接用 props：SSR/hydration 首轮就要渲染评论，
  // 渲染期模式只负责 props 引用变化（router.refresh 后）时重置
  const [liveComments, setLiveComments] = useState<CommentShape[]>(comments);
  const [baseComments, setBaseComments] = useState(comments);
  if (baseComments !== comments) {
    setBaseComments(comments);
    setLiveComments(comments);
  }
  // 服务端时钟基准，避免客户端时钟偏差
  const sinceRef = useRef<string>(new Date().toISOString());
  // live/base 的最新值（poll 回调用，渲染期不读写）
  const liveRef = useRef<CommentShape[] | null>(null);
  const baseCommentsRef = useRef<CommentShape[]>(comments);
  // poll 实例（实时信号与定时器都通过它触发，避免两处各持一份闭包）
  const pollRef = useRef<(() => void) | null>(null);

  // props 变化（router.refresh）时同步 ref、重置轮询基准
  useEffect(() => {
    baseCommentsRef.current = comments;
    liveRef.current = comments; // props 全量覆盖（发帖/删帖后的 refresh）
    const times = comments
      .map((c) => new Date(c.createdAt).getTime())
      .filter((t) => !Number.isNaN(t));
    if (times.length > 0) sinceRef.current = new Date(Math.max(...times)).toISOString();
  }, [comments]);

  useEffect(() => {
    async function poll() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(
          `/api/comments?resourceId=${encodeURIComponent(resourceId)}&since=${encodeURIComponent(sinceRef.current)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          items: NewCommentItem[];
          serverTime: string;
          liveIds: string[];
        };
        sinceRef.current = data.serverTime;

        // 取最新的列表（effect 闭包只挂一次，state 会过期；ref 同步放 effect 里）
        const cur = liveRef.current ?? baseCommentsRef.current;

        // 删除兜底：本地有但服务端 liveIds 没有的评论 → 全量刷新
        const localIds = new Set(cur.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]));
        if ([...localIds].some((id) => !data.liveIds.includes(id))) {
          router.refresh();
          return;
        }

        if (data.items.length > 0) {
          const byId = new Map(cur.flatMap((c) => [[c.id, c] as const]));
          const next = cur.map((c) => ({ ...c, replies: [...c.replies] }));
          let needFull = false;
          for (const item of data.items) {
            if (byId.has(item.id)) continue; // 已存在（自己刚发的，router.refresh 已带上）
            if (!item.parentId) {
              next.push({
                id: item.id,
                authorId: item.authorId,
                content: item.content,
                createdAt: item.createdAt,
                author: item.author,
                images: item.images ?? [],
                replies: [],
              });
            } else {
              // 挂到根楼层；增量回复的父楼层可能是另一条增量回复，也可能不在本地
              let pid: string | null = item.parentId;
              let guard = 0;
              while (pid && guard++ < 20) {
                const parentItem = data.items.find((x) => x.id === pid);
                pid = parentItem?.parentId ?? null;
              }
              const root = next.find((c) => c.id === pid);
              if (root) {
                root.replies.push({
                  id: item.id,
                  authorId: item.authorId,
                  content: item.content,
                  createdAt: item.createdAt,
                  author: item.author,
                  replyTo: item.replyTo ?? null,
                });
              } else {
                needFull = true;
                break;
              }
            }
          }
          if (needFull) router.refresh();
          else {
            liveRef.current = next;
            setLiveComments(next);
          }
        }
      } catch {
        // 网络抖动忽略，下一轮重试
      }
    }

    pollRef.current = () => void poll();
    return () => {
      pollRef.current = null;
    };
    // 闭包取不到最新 state，全部走 ref；poll 只在 resourceId 变化时重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  // 订阅本资源的评论房间：实时信号到达即拉一次增量
  useRealtimeRoom(roomResource(resourceId));
  useRealtimeMessages((msg) => {
    if (msg.t === "comment:new" && msg.resourceId === resourceId) {
      pollRef.current?.();
    } else if (msg.t === "comment:changed" && msg.resourceId === resourceId) {
      // 删除/审核导致结构变化：增量端点无法表达，直接全量刷新
      router.refresh();
    }
  });

  // 兜底轮询：WS 在线时放长（补漏），连不上时保持原有节奏
  useEffect(() => {
    const timer = setInterval(
      () => pollRef.current?.(),
      connected ? FALLBACK_POLL_MS : DEGRADED_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [connected]);

  // 刚连上实时通道时补拉一次：订阅生效前发生的评论不会被推送，靠这一下补齐
  useEffect(() => {
    if (connected) pollRef.current?.();
  }, [connected]);

  return liveComments;
}

/** 滚动到目标评论并闪烁（原生平滑滚动 + 重触发动画）；目标不存在时返回 false */
export function flashComment(el: HTMLElement) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("comment-flash");
  void el.offsetWidth;
  el.classList.add("comment-flash");
}
