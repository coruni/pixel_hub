"use client";

import { useState } from "react";
import { ChevronUp } from "lucide-react";
import ImageViewer, { type ViewerImage } from "@/components/ui/ImageViewer";
import { Button } from "@/components/ui/Button";

export type QueueMediaItem = {
  id: string;
  thumbUrl: string;
  url: string;
  width: number | null;
  height: number | null;
  cover: boolean;
};

/** 折叠时最多显示几张：再多就会把条目撑高，把后面的内容推到屏幕外 */
const PREVIEW_COUNT = 3;

/**
 * 审核队列预览图条：默认只展示前几张（带「还有 N 张」提示），需要时展开。
 *
 * 审核队列是一屏要过很多条的列表，图片全部铺开会把单条卡片撑到几百像素高
 * （图集张数上限已放开、没有上界），后面待审的内容直接被推到屏幕外。
 * 折叠后单条高度稳定，图片仍可通过展开或点缩略图进查看器核对。
 */
export function QueueMediaStrip({ media }: { media: QueueMediaItem[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (media.length === 0) return null;

  const viewerImages: ViewerImage[] = media.map((m) => ({
    url: m.url,
    width: m.width,
    height: m.height,
  }));

  const hidden = media.length - PREVIEW_COUNT;
  const collapsible = hidden > 0;
  const shown = expanded || !collapsible ? media : media.slice(0, PREVIEW_COUNT);
  // 单张时收窄，避免一张图就占掉一整行宽度
  const single = media.length === 1;

  const thumbClass = (isCover: boolean) =>
    `group relative block shrink-0 cursor-zoom-in overflow-hidden rounded-none border bg-neutral-100 p-0 text-left transition hover:border-brand-500 ${
      single ? "h-16 w-24" : "h-20 w-28"
    } ${isCover ? "border-brand-500" : "border-brand-200"}`;

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {shown.map((m, i) => (
          <Button
            key={m.id}
            type="button"
            onClick={() => setIndex(i)}
            title="查看原图"
            className={thumbClass(m.cover)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.thumbUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
            {m.cover && (
              <span className="absolute left-1 top-1 rounded-none border border-brand-600 bg-brand-500 px-1 text-[9px] font-medium text-white">
                封面
              </span>
            )}
            <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 text-[10px] text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
              查看原图
            </span>
          </Button>
        ))}

        {/* 折叠态：用一块缩略图大小的占位把「还有多少张」明说清楚，并可一键展开 */}
        {collapsible && !expanded && (
          <Button
            type="button"
            onClick={() => setExpanded(true)}
            title={`展开其余 ${hidden} 张`}
            className={`${thumbClass(false)} grid place-items-center gap-0.5 text-neutral-500 hover:text-neutral-900`}
          >
            <span className="text-sm font-medium tabular-nums">+{hidden}</span>
            <span className="text-[10px]">展开</span>
          </Button>
        )}

        {collapsible && expanded && (
          <Button
            type="button"
            onClick={() => setExpanded(false)}
            className="inline-flex items-center gap-1 self-center rounded-none px-2 py-1 text-xs text-neutral-500 transition hover:text-neutral-900"
          >
            <ChevronUp size={12} aria-hidden />
            收起
          </Button>
        )}

        <span className="self-center text-xs text-neutral-400">共 {media.length} 张</span>
      </div>
      {index !== null && (
        <ImageViewer
          images={viewerImages}
          index={index}
          onIndexChange={setIndex}
          onClose={() => setIndex(null)}
        />
      )}
    </>
  );
}
