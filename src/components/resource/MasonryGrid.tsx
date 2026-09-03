"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FeedCard } from "@/lib/queries";
import ResourceCard from "./ResourceCard";

const BODY_PX = 2; // 卡片边框近似高（信息全覆盖图后无图下统计条；估算只需 cover 比例）

function aspectOf(it: FeedCard) {
  const cw = it.cover?.width && it.cover.width > 0 ? it.cover.width : 3;
  const ch = it.cover?.height && it.cover.height > 0 ? it.cover.height : 2;
  // 与 ResourceCard 一致：封面比例限幅 [4/3, 3/4]（竖图不拉长、横图不超矮）
  return { cw, ch: Math.min(Math.max(ch, (cw * 3) / 4), (cw * 4) / 3) };
}
function colsForWidth(w: number, maxCols: number) {
  // w 是容器 clientWidth（max-w-7xl 页面在 xl 视口下只有 1232px，达不到 1280），
  // 阈值按容器宽而非视口断点取：≥1200 开满 maxCols；带侧栏的主列(~888px)四列；~md 视口起 3 列
  if (w >= 1200) return Math.max(2, maxCols);
  if (w >= 820) return Math.min(4, maxCols);
  if (w >= 700) return Math.min(3, maxCols);
  return 2;
}

/** SSR/无 JS 占位的响应式列数（容器查询，断点与 colsForWidth 一致；外层须声明 @container） */
function placeholderCols(maxCols: number): string {
  if (maxCols <= 2) return "columns-2";
  if (maxCols === 3) return "columns-2 @[700px]:columns-3";
  if (maxCols === 4) return "columns-2 @[700px]:columns-3 @[820px]:columns-4";
  return "columns-2 @[700px]:columns-3 @[820px]:columns-4 @[1200px]:columns-5";
}

export default function MasonryGrid({
  items,
  className = "",
  maxCols = 4,
  gap = 16,
}: {
  items: FeedCard[];
  className?: string;
  maxCols?: number; // 1280px 以上最大列数（下探 768→min(3)，<768→2）
  gap?: number; // 列间距 px（数据可算高估用）
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; cols: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const cols = colsForWidth(w, maxCols);
      setBox((prev) => (prev && prev.w === w && prev.cols === cols ? prev : { w, cols }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxCols]);

  const colItems = useMemo(() => {
    if (!box) return null;
    const colW = (box.w - gap * (box.cols - 1)) / box.cols;
    const acc = Array.from({ length: box.cols }, () => ({ list: [] as FeedCard[], h: 0 }));
    for (const it of items) {
      let best = 0;
      for (let c = 1; c < acc.length; c++) if (acc[c].h < acc[best].h) best = c;
      acc[best].list.push(it);
      const { cw, ch } = aspectOf(it);
      acc[best].h += colW * (ch / cw) + BODY_PX + gap;
    }
    return acc;
  }, [box, items, gap]);

  if (items.length === 0) return null;

  if (!colItems) {
    // 服务端 / 首帧占位:CSS 多列。列数用容器查询断点（与 JS colsForWidth 同一套阈值），
    // 有无侧边栏、任意容器宽都与 JS 接管后的列数一致；break-inside:avoid 防卡片被拦腰分列
    return (
      <div ref={ref} className={`@container ${className}`}>
        <div style={{ gap }} className={placeholderCols(maxCols)}>
          {items.map((it) => (
            <div key={it.id} style={{ marginBottom: gap, breakInside: "avoid" }}>
              <ResourceCard item={it} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} className={`flex items-start ${className}`} style={{ gap }}>
      {colItems.map((col, i) => (
        // 列内卡片垂直间距 = gap（grid rowGap；与列高估算中的 per-card gap 一致）
        <div key={i} className="min-w-0 flex-1" style={{ display: "grid", rowGap: gap }}>
          {col.list.map((it) => (<ResourceCard key={it.id} item={it} />))}
        </div>
      ))}
    </div>
  );
}
