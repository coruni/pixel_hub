"use client";

import { useState } from "react";
import ImageViewer, { type ViewerImage } from "@/components/ui/ImageViewer";

export type QueueMediaItem = {
  id: string;
  thumbUrl: string;
  url: string;
  width: number | null;
  height: number | null;
  cover: boolean;
};

/** 审核队列预览图条：点击缩略图进图片查看器（大图/多图切换/缩放/旋转） */
export function QueueMediaStrip({ media }: { media: QueueMediaItem[] }) {
  const [index, setIndex] = useState<number | null>(null);
  if (media.length === 0) return null;

  const viewerImages: ViewerImage[] = media.map((m) => ({
    url: m.url,
    width: m.width,
    height: m.height,
  }));

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {media.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setIndex(i)}
            title="点击查看原图"
            className="group relative block h-20 w-28 shrink-0 cursor-zoom-in overflow-hidden rounded-none border border-brand-200 bg-neutral-100 p-0 text-left transition hover:border-brand-500"
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
          </button>
        ))}
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
