"use client";

import { useState } from "react";
import ImageViewer from "@/components/ui/ImageViewer";

/** 媒体库缩略图：点击进图片查看器（大图查看/缩放/旋转） */
export function MediaThumb({
  url,
  bigUrl,
  fileName,
}: {
  url: string;
  bigUrl: string;
  fileName: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={fileName ? `查看 ${fileName}` : "查看图片"}
        className="block rounded-none transition hover:border-brand-500"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={fileName ?? "media"}
          loading="lazy"
          className="h-12 w-12 rounded-none border border-brand-200 object-cover"
        />
      </button>
      {open && (
        <ImageViewer
          images={[{ url: bigUrl, width: null, height: null }]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
