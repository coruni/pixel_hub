"use client";

import { useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Keyboard } from "swiper/modules";
import type { Swiper as SwiperClass } from "swiper";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ImageViewer from "@/components/ui/ImageViewer";
import "swiper/css";

export type GalleryMedia = {
  id: string;
  thumbUrl: string;
  bigUrl: string;
  width: number | null;
  height: number | null;
  placeholder: string | null;
};

export default function Gallery({ media }: { media: GalleryMedia[] }) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [swiper, setSwiper] = useState<SwiperClass | null>(null);

  const multi = media.length > 1;
  const hasPrev = index > 0;
  const hasNext = index < media.length - 1;

  if (media.length === 0) {
    return (
      <div className="grid aspect-[3/2] place-items-center rounded-none border border-brand-200 bg-neutral-100 text-sm text-neutral-400">
        暂无预览图
      </div>
    );
  }

  // hover 才出现：opacity-0 + group-hover:opacity-100；首末张对应方向禁用并隐藏
  const arrowBtn = (side: "left" | "right", enabled: boolean) =>
    `absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-none border border-brand-600 bg-stone-900/85 text-white transition ${
      side === "left" ? "left-3" : "right-3"
    } ${enabled ? "opacity-0 hover:bg-brand-600 group-hover:opacity-100" : "pointer-events-none opacity-0"}`;

  return (
    <div>
      {/* 主图轮播：swiper 拖动/触摸切换，hover 出箭头 */}
      <div className="group relative overflow-hidden rounded-none border border-brand-200 bg-neutral-900 ">
        <Swiper
          modules={[Keyboard]}
          keyboard={{ enabled: true }}
          onSwiper={setSwiper}
          onSlideChange={(s) => setIndex(s.activeIndex)}
        >
          {media.map((m) => (
            <SwiperSlide
              key={m.id}
              className="flex h-[50vh]! items-center justify-center"
              onClick={() => {
                // swiper 的 preventClicks 会吞掉拖动后的 click，这里只处理真点击
                setLightbox(true);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.bigUrl}
                alt="预览"
                width={m.width ?? undefined}
                height={m.height ?? undefined}
                draggable={false}
                className="max-h-full max-w-full h-full cursor-zoom-in select-none object-cover"
              />
            </SwiperSlide>
          ))}
        </Swiper>
        {multi && (
          <>
            <button
              type="button"
              className={arrowBtn("left", hasPrev)}
              disabled={!hasPrev}
              onClick={() => swiper?.slidePrev()}
              aria-label="上一张"
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <button
              type="button"
              className={arrowBtn("right", hasNext)}
              disabled={!hasNext}
              onClick={() => swiper?.slideNext()}
              aria-label="下一张"
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </>
        )}
      </div>

      {multi && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex flex-1 gap-2 overflow-x-auto pb-1">
            {media.map((m, i) => (
              <button
                type="button"
                key={m.id}
                onClick={() => {
                  setIndex(i);
                  swiper?.slideTo(i);
                }}
                className={`h-16 w-24 shrink-0 overflow-hidden rounded-none border transition ${
                  i === index
                    ? "border-brand-500"
                    : "border-transparent opacity-70 hover:opacity-100"
                }`}
                aria-label={`第 ${i + 1} 张`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.thumbUrl} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {lightbox && (
        <ImageViewer
          images={media.map((m) => ({
            url: m.bigUrl,
            width: m.width,
            height: m.height,
          }))}
          index={index}
          onIndexChange={(i) => {
            setIndex(i);
            swiper?.slideTo(i);
          }}
          onClose={() => setLightbox(false)}
        />
      )}
    </div>
  );
}
