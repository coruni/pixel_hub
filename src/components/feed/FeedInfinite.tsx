"use client";

import { useEffect, useRef, useState } from "react";
import { loadBrowseFeedAction, type BrowseFeedParams } from "@/lib/actions/feedmore";
import type { FeedCard } from "@/lib/queries";
import Loader from "@/components/Loader";
import ResourceGrid from "@/components/resource/ResourceGrid";

const PAGE_SIZE = 30;

type FeedFilters = Omit<BrowseFeedParams, "page" | "pageSize">;

/**
 * /browse 的无限滚动流：首屏 initial 由 SSR 注入，滚近底部（提前约一屏高）时自动取下一页并
 * append 进同一条卡片网格（统一 3:4 竖版卡，追页只是网格自然加长）。
 * 筛选条仍是服务端 Link（换筛选 = 换 URL = 本组件以新首屏重挂），因此「返回顶部/重来」天然成立。
 */
export default function FeedInfinite({
  initial,
  initialHasMore,
  params,
  emptyText,
}: {
  initial: FeedCard[];
  initialHasMore: boolean;
  params: FeedFilters;
  emptyText: string;
}) {
  const [items, setItems] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [done, setDone] = useState(!initialHasMore);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pageRef = useRef(1);
  const busyRef = useRef(false);
  const doneRef = useRef(!initialHasMore);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  async function loadNext() {
    if (busyRef.current || doneRef.current) return;
    busyRef.current = true;
    setPending(true);
    setErr(null);
    try {
      const r = await loadBrowseFeedAction({
        ...params,
        page: pageRef.current + 1,
        pageSize: PAGE_SIZE,
      });
      if (!r.ok) {
        setErr(r.error ?? "加载失败");
        return;
      }
      if (r.items.length > 0) setItems((prev) => [...prev, ...r.items]);
      pageRef.current += 1;
      setHasMore(r.hasMore);
      if (!r.hasMore || r.items.length === 0) {
        doneRef.current = true;
        setDone(true);
      }
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }

  // 滚近底部自动加载：hasMore/err 变化后重挂观察器，逐页追到 done/err（busy 防并发）
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || done || !hasMore || err) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadNext();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, done, err]);

  if (items.length === 0 && done) {
    return <div className="mt-20 text-center text-sm text-neutral-400">{emptyText}</div>;
  }

  return (
    <div>
      {/* 统一 3:4 竖版卡：PC 4 列 / 平板 3 列 / 移动 2 列（与 ResourceGrid card 断点一致） */}
      <ResourceGrid className="mt-4" items={items} display="card" ratio="3:4" />

      {err && (
        <div className="mt-5 flex flex-col items-center gap-2 text-center">
          <p className="text-xs text-red-500">{err}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => void loadNext()}
            className="rounded-none border border-brand-200 bg-surface px-4 py-1.5 text-xs text-neutral-700 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
          >
            重试
          </button>
        </div>
      )}

      {done ? (
        items.length > 0 && (
          <div className="mt-6 flex items-center justify-center">
            <span className="text-xs text-neutral-400">已全部加载</span>
          </div>
        )
      ) : (
        <div ref={sentinelRef} className="mt-6 flex items-center justify-center" aria-live="polite">
          {pending ? (
            <Loader label="加载中…" />
          ) : (
            <span className="text-xs text-neutral-300">向下滚动加载更多</span>
          )}
        </div>
      )}
    </div>
  );
}
