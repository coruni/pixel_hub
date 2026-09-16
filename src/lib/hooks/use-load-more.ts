"use client";

import { useRef, useState, useTransition } from "react";
import type { ActionResult } from "./use-action";

export type LoadMorePage<T> = ActionResult & { items: T[]; hasMore: boolean };

/**
 * 「加载更多」分页状态机：每次 loadNext 取下一页并追加，hasMore 为 false 或空页即完结（done）。
 * fetchPage 由调用方传入（携带板块筛选等参数）。翻页按钮与无限滚动共用这一套。
 *
 * 两处刻意用 ref 而不是 state：
 * · page 用 ref：无限滚动把 loadNext 交给 IntersectionObserver 的回调持有，观察器跨页常驻，
 *   闭包会一直引用创建时那一份 page。若用 state，追第二页之后每次都还会去请求同一页（重复卡片）。
 * · 在飞闩用 ref：transition 的 pending 要等下一帧重渲染才变 true，同一帧内连点按钮或观察器
 *   重复触发都能越过 pending 判断，用同一个 page 取两次。
 */
export function useLoadMore<T>(fetchPage: (page: number) => Promise<LoadMorePage<T>>) {
  const [more, setMore] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pageRef = useRef(1);
  const busyRef = useRef(false);
  // done 也镜像成 ref：观察器回调持的是旧闭包，读到的 done 可能是过期的 false
  const doneRef = useRef(false);

  function loadNext() {
    if (busyRef.current || doneRef.current) return;
    busyRef.current = true;
    start(async () => {
      try {
        const r = await fetchPage(pageRef.current + 1);
        if (!r.ok) {
          setErr(r.error ?? "加载失败");
          return;
        }
        setMore((prev) => [...prev, ...r.items]);
        pageRef.current += 1;
        setHasMore(r.hasMore);
        if (!r.hasMore || r.items.length === 0) {
          doneRef.current = true;
          setDone(true);
        }
      } finally {
        busyRef.current = false;
      }
    });
  }

  return { more, hasMore, done, err, pending, loadNext };
}
