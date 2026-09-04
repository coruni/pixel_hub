"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "./use-action";

export type LoadMorePage<T> = ActionResult & { items: T[]; hasMore: boolean };

/**
 * 「加载更多」分页状态机：page 从 1 起步，每次 loadNext 取下一页并追加，
 * hasMore 为 false 或空页即完结（done）。fetchPage 由调用方传入（携带板块筛选等参数）。
 */
export function useLoadMore<T>(fetchPage: (page: number) => Promise<LoadMorePage<T>>) {
  const [page, setPage] = useState(1);
  const [more, setMore] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function loadNext() {
    if (pending || done) return;
    start(async () => {
      const r = await fetchPage(page + 1);
      if (!r.ok) {
        setErr(r.error ?? "加载失败");
        return;
      }
      setMore((prev) => [...prev, ...r.items]);
      setPage((p) => p + 1);
      setHasMore(r.hasMore);
      if (!r.hasMore || r.items.length === 0) setDone(true);
    });
  }

  return { more, hasMore, done, err, pending, loadNext };
}
