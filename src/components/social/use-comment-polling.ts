"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CommentShape, NewCommentItem } from "./comment-types";

/**
 * 评论实时刷新：每 15s 拉增量新评论合并进列表（不 router.refresh，不打断输入状态）。
 * props 全量覆盖 props 引用变化（发帖/删帖后的 refresh）；服务端删帖由 liveIds 差集兜底触发全量刷新。
 */
export function useCommentPolling(resourceId: string, comments: CommentShape[]) {
  const router = useRouter();
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
  // props 变化（router.refresh）时同步 ref、重置轮询基准
  useEffect(() => {
    baseCommentsRef.current = comments;
    liveRef.current = comments; // props 全量覆盖（发帖/删帖后的 refresh）
    const times = comments.map((c) => new Date(c.createdAt).getTime()).filter((t) => !Number.isNaN(t));
    if (times.length > 0) sinceRef.current = new Date(Math.max(...times)).toISOString();
  }, [comments]);

  useEffect(() => {
    async function poll() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(
          `/api/comments?resourceId=${encodeURIComponent(resourceId)}&since=${encodeURIComponent(sinceRef.current)}`,
          { cache: "no-store" }
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

    const timer = setInterval(poll, 15000);
    return () => clearInterval(timer);
    // 闭包取不到最新 state，全部走 ref；interval 只挂一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  return liveComments;
}

/** 滚动到目标评论并闪烁（原生平滑滚动 + 重触发动画）；目标不存在时返回 false */
export function flashComment(el: HTMLElement) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("comment-flash");
  void el.offsetWidth;
  el.classList.add("comment-flash");
}
