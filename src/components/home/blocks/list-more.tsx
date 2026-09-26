"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import type { CardRatio, ContentDisplay, ContentType } from "@/lib/display";
import { loadListPageAction } from "@/lib/actions/feedmore";
import { useLoadMore } from "@/lib/hooks";
import ResourceGrid from "@/components/resource/ResourceGrid";
import Loader from "@/components/Loader";
import { Button } from "@/components/ui/Button";

type Sort = "latest" | "popular" | "downloads";
type Item = Awaited<ReturnType<typeof loadListPageAction>>["items"][number];

/** 追加方式：button=点按钮取下一页；infinite=滚近底部自动取（与 /browse 的无限滚动同一套手感） */
export type LoadMoreMode = "button" | "infinite";

/** 首页 list 板块的后续页：按板块相同筛选取下一页并追加渲染 */
export default function ListMore({
  type,
  sort,
  categorySlugs,
  tagSlugs,
  pageSize,
  display,
  ratio,
  period,
  mode = "button",
  nicknameEnabled = true,
}: {
  type: "ALL" | ContentType;
  sort: Sort;
  categorySlugs: string[];
  tagSlugs: string[];
  pageSize: number;
  display: ContentDisplay;
  ratio?: CardRatio | null;
  /** 时间窗口：与首屏一致，保证后续页用同一筛选条件 */
  period?: "week" | "month";
  mode?: LoadMoreMode;
  /** 昵称特效色总开关：客户端组件读不到服务端配置，必须由服务端板块传下来 */
  nicknameEnabled?: boolean;
}) {
  const { more, hasMore, done, err, pending, loadNext } = useLoadMore<Item>((page) =>
    loadListPageAction({ page, pageSize, type, sort, categorySlugs, tagSlugs, period }),
  );
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const infinite = mode === "infinite";

  // 无限滚动：滚近底部（提前约一屏）自动取下一页，跟 /browse 的 FeedInfinite 同一套写法。
  // 依赖里带 more.length：每追加一页就重挂观察器，observe() 会立刻回调一次——内容不足一屏时
  // 继续往下补，而不是等用户再滚一下（追加区还在视口内时交集状态不变，老观察器不会再触发）。
  // 重复触发由 useLoadMore 的在飞闩挡掉；page 由 hook 内的 ref 持有，闭包不会取到旧页。
  useEffect(() => {
    if (!infinite) return;
    const el = sentinelRef.current;
    if (!el || done || !hasMore || err) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadNext();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infinite, hasMore, done, err, more.length]);

  if (done) {
    return (
      <div className="mt-5 flex items-center justify-center">
        <span className="text-xs text-neutral-400">已全部加载</span>
      </div>
    );
  }

  return (
    <div>
      {more.length > 0 && (
        <div className="mt-4">
          <ResourceGrid
            items={more}
            display={display}
            ratio={ratio}
            nicknameEnabled={nicknameEnabled}
          />
        </div>
      )}
      {err && <p className="mt-2 text-center text-xs text-red-500">{err}</p>}

      {hasMore && !infinite && (
        <div className="mt-5 flex justify-center">
          <Button type="button" disabled={pending} onClick={loadNext} variant="ghost" size="md">
            {pending ? "加载中…" : more.length > 0 ? "下一页" : "加载更多"}
            <ChevronDown size={14} aria-hidden />
          </Button>
        </div>
      )}

      {hasMore && infinite && (
        <div
          ref={sentinelRef}
          className="flex min-h-8 items-center justify-center pt-5"
          aria-live="polite"
        >
          {pending ? (
            <Loader label="加载中…" />
          ) : (
            err && (
              <Button type="button" onClick={loadNext} variant="ghost" size="md">
                重试
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}
