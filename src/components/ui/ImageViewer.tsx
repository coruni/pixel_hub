"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minus, Plus, RotateCcw, RotateCw, X } from "lucide-react";

export type ViewerImage = {
  url: string;
  width: number | null;
  height: number | null;
};

/**
 * 通用图片查看器（lightbox）：滚轮/按钮缩放、90° 旋转、放大态拖动平移、多图切换。
 * 受控组件：由父级决定打开与当前索引。
 */
export default function ImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: ViewerImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // 上一张图的索引：index 变化时在渲染期间复位变换（替代 effect 里 setState）
  const [prevIndex, setPrevIndex] = useState(index);
  if (prevIndex !== index) {
    setPrevIndex(index);
    setZoom(1);
    setRotation(0);
    setPos({ x: 0, y: 0 });
  }
  const draggingRef = useRef(false);
  const lastPtRef = useRef({ x: 0, y: 0 });

  const current = images[index];
  const multi = images.length > 1;
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  const clampZoom = (z: number) => Math.min(8, Math.max(0.2, z));
  const zoomTo = useCallback((factor: number) => setZoom((z) => clampZoom(z * factor)), []);
  const reset = () => {
    setZoom(1);
    setRotation(0);
    setPos({ x: 0, y: 0 });
  };

  // 键盘：Esc 关闭 / ←→ 切图 / +- 0 缩放 / R 旋转 / F 复位
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          if (index > 0) onIndexChange(index - 1);
          break;
        case "ArrowRight":
          if (index < images.length - 1) onIndexChange(index + 1);
          break;
        case "+":
        case "=":
          zoomTo(1.25);
          break;
        case "-":
        case "_":
          zoomTo(1 / 1.25);
          break;
        case "0":
          reset();
          break;
        case "r":
        case "R":
          setRotation((r) => r + 90);
          break;
        case "f":
        case "F":
          reset();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onIndexChange, index, images.length, zoomTo]);

  // 打开时锁定 body 滚动，避免穿透
  useEffect(() => {
    const { overflow, paddingRight } = document.body.style;
    // 补偿滚动条消失引起的布局跳动
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // 仅在放大态下允许拖动平移
    if (zoom === 1) return;
    e.stopPropagation();
    draggingRef.current = true;
    lastPtRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    const dx = e.clientX - lastPtRef.current.x;
    const dy = e.clientY - lastPtRef.current.y;
    lastPtRef.current = { x: e.clientX, y: e.clientY };
    setPos((p) => ({ x: p.x + dx, y: p.y + dy }));
  };

  const onPointerUp = () => {
    draggingRef.current = false;
  };

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      onWheel={onWheel}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 z-30 p-1 text-white/70 transition hover:text-white"
        aria-label="关闭"
      >
        <X size={24} />
      </button>

      {/* 工具栏：旋转 / 缩放 / 复位；z 高于图片，避免放大/拖动后被图盖住 */}
      <div
        className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-none border border-white/15 bg-stone-900/85 p-1 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setRotation((r) => r - 90)}
          className="grid h-9 w-9 place-items-center hover:bg-white/10"
          aria-label="左旋 90°"
          title="左旋 90°"
        >
          <RotateCcw size={16} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setRotation((r) => r + 90)}
          className="grid h-9 w-9 place-items-center hover:bg-white/10"
          aria-label="右旋 90°"
          title="右旋 90°"
        >
          <RotateCw size={16} aria-hidden />
        </button>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <button
          type="button"
          onClick={() => zoomTo(1 / 1.25)}
          className="grid h-9 w-9 place-items-center hover:bg-white/10"
          aria-label="缩小"
          title="缩小"
        >
          <Minus size={16} aria-hidden />
        </button>
        <span className="grid h-9 w-9 select-none place-items-center text-xs tabular-nums text-white/70">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoomTo(1.25)}
          className="grid h-9 w-9 place-items-center hover:bg-white/10"
          aria-label="放大"
          title="放大"
        >
          <Plus size={16} aria-hidden />
        </button>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <button type="button" onClick={reset} className="grid h-9 w-9 place-items-center hover:bg-white/10" aria-label="复位" title="复位">
          <Maximize size={16} aria-hidden />
        </button>
      </div>

      {multi && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (hasPrev) onIndexChange(index - 1);
            }}
            className={`absolute left-4 top-1/2 z-30 -translate-y-1/2 rounded-none bg-white/10 p-3 text-white hover:bg-white/20 ${
              hasPrev ? "" : "pointer-events-none opacity-30"
            }`}
            aria-label="上一张"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (hasNext) onIndexChange(index + 1);
            }}
            className={`absolute right-4 top-1/2 z-30 -translate-y-1/2 rounded-none bg-white/10 p-3 text-white hover:bg-white/20 ${
              hasNext ? "" : "pointer-events-none opacity-30"
            }`}
            aria-label="下一张"
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current.url}
        alt="大图预览"
        width={current.width ?? undefined}
        height={current.height ?? undefined}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="max-h-[92vh] max-w-full touch-none select-none object-contain transition-transform duration-150 ease-out"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) rotate(${rotation}deg) scale(${zoom})`,
          cursor: zoom > 1 ? "grab" : "zoom-in",
        }}
      />
    </div>
  );
}
