"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

export type ViewerImage = {
  url: string;
  width: number | null;
  height: number | null;
};

type Pt = { x: number; y: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 通用图片查看器（lightbox）：滚轮/按钮缩放、90° 旋转、放大态拖动平移、多图切换。
 * 移动端手势：双指捏合缩放（含双指中心跟随）、单指水平滑动切换上一张/下一张（放大态单指为平移）。
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
  // 拖动/捏合/滑动过程中关掉过渡动画，避免跟手迟滞；结束恢复做回弹动画
  const [gesturing, setGesturing] = useState(false);
  // refs 镜像变换状态：pointer 事件回调里需要读“最新”值（state 闭包是旧值）
  const zoomRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });

  // 上一张图的索引：index 变化时在渲染期间复位 state（替代 effect 里 setState）
  const [prevIndex, setPrevIndex] = useState(index);
  if (prevIndex !== index) {
    setPrevIndex(index);
    setZoom(1);
    setRotation(0);
    setPos({ x: 0, y: 0 });
  }
  // refs 镜像在绘制前同步（render 期间不允许写 ref）
  useLayoutEffect(() => {
    zoomRef.current = 1;
    posRef.current = { x: 0, y: 0 };
  }, [index]);

  const rootRef = useRef<HTMLDivElement>(null);
  // 活动指针表与手势状态机
  const ptrsRef = useRef(new Map<number, Pt>());
  const kindRef = useRef<"idle" | "pan" | "pinch" | "swipe" | "ignored">("idle");
  const lastPtRef = useRef<Pt>({ x: 0, y: 0 });
  const pinchRef = useRef({ dist: 1, zoom: 1, pos: { x: 0, y: 0 }, cx: 0, cy: 0 });
  const swipeRef = useRef({ sx: 0, sy: 0, active: false });
  const suppressClickRef = useRef(false);

  // 对话框打开时把焦点收进浮层（Esc/Tab 键盘操作以它为起点）
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const current = images[index];
  const multi = images.length > 1;
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  const clampZoom = (z: number) => Math.min(8, Math.max(0.2, z));
  const setZoomBoth = useCallback((z: number) => {
    zoomRef.current = z;
    setZoom(z);
  }, []);
  const setPosBoth = useCallback((p: Pt) => {
    posRef.current = p;
    setPos(p);
  }, []);
  const zoomTo = useCallback((factor: number) => setZoomBoth(clampZoom(zoomRef.current * factor)), [setZoomBoth]);
  const reset = useCallback(() => {
    zoomRef.current = 1;
    posRef.current = { x: 0, y: 0 };
    setZoom(1);
    setPos({ x: 0, y: 0 });
  }, []);

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
  }, [onClose, onIndexChange, index, images.length, zoomTo, reset]);

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
    setZoomBoth(clampZoom(zoomRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    // 落在按钮/工具栏等控件上时不接管手势，保证点击/聚焦正常
    if ((e.target as HTMLElement).closest("button")) return;
    const pid = e.pointerId;
    const p = { x: e.clientX, y: e.clientY };
    ptrsRef.current.set(pid, p);
    const pts = [...ptrsRef.current.values()];

    if (pts.length === 2) {
      // 第二根手指落下 → 进入捏合
      const [a, b] = pts;
      pinchRef.current = {
        dist: dist(a, b) || 1,
        zoom: zoomRef.current,
        pos: { ...posRef.current },
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
      kindRef.current = "pinch";
      suppressClickRef.current = true;
      setGesturing(true);
      return;
    }

    if (zoomRef.current > 1) {
      // 放大态：单指/鼠标拖动平移
      kindRef.current = "pan";
      lastPtRef.current = p;
      setGesturing(true);
      // 鼠标/笔离开元素后仍持续收到事件；触摸走隐式捕获即可
      if (e.pointerType !== "touch") (e.currentTarget as HTMLElement).setPointerCapture?.(pid);
      return;
    }

    // 原始大小：鼠标不响应拖动（保持点按/滚轮语义）；触摸/笔允许滑动切图
    if (e.pointerType === "mouse") {
      kindRef.current = "ignored";
      return;
    }
    kindRef.current = "swipe";
    swipeRef.current = { sx: p.x, sy: p.y, active: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pid = e.pointerId;
    if (!ptrsRef.current.has(pid)) return;
    const cur = { x: e.clientX, y: e.clientY };
    ptrsRef.current.set(pid, cur);
    const pts = [...ptrsRef.current.values()];
    e.stopPropagation();

    if (kindRef.current === "pinch" && pts.length === 2) {
      const [a, b] = pts;
      const g = pinchRef.current;
      const ratio = dist(a, b) / g.dist;
      setZoomBoth(clampZoom(g.zoom * ratio));
      // 双指中心移动跟随平移
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      setPosBoth({ x: g.pos.x + (cx - g.cx), y: g.pos.y + (cy - g.cy) });
      return;
    }

    if (kindRef.current === "pan" && pts.length === 1) {
      const dx = cur.x - lastPtRef.current.x;
      const dy = cur.y - lastPtRef.current.y;
      lastPtRef.current = cur;
      setPosBoth({ x: posRef.current.x + dx, y: posRef.current.y + dy });
      return;
    }

    if (kindRef.current === "swipe" && pts.length === 1) {
      const s = swipeRef.current;
      const dx = cur.x - s.sx;
      const dy = cur.y - s.sy;
      if (!s.active) {
        // 先判断方向：明显横向才算滑动，纵向/微小抖动忽略
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          s.active = true;
          suppressClickRef.current = true;
          setGesturing(true);
        } else {
          kindRef.current = "ignored";
          return;
        }
      }
      // 跟手横移（纵向分量丢弃，避免画面上下飘）
      setPosBoth({ x: dx, y: 0 });
    }
  };

  const endGesture = () => {
    ptrsRef.current.clear();
    kindRef.current = "idle";
    setGesturing(false);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const pid = e.pointerId;
    const had = ptrsRef.current.delete(pid);
    if (!had) return;
    e.stopPropagation();

    if (kindRef.current === "swipe") {
      const s = swipeRef.current;
      if (s.active) {
        const dx = posRef.current.x;
        if (Math.abs(dx) >= 52) {
          if (dx < 0 && hasNext) onIndexChange(index + 1);
          else if (dx > 0 && hasPrev) onIndexChange(index - 1);
          else setPosBoth({ x: 0, y: 0 });
        } else {
          // 未达阈值：回弹到原位（恢复 transition 后带动画）
          setPosBoth({ x: 0, y: 0 });
        }
      }
      endGesture();
      return;
    }

    if (ptrsRef.current.size === 0) {
      endGesture();
      return;
    }
    // 捏合中抬起一指 → 剩下单指转平移（若在放大态）
    const [only] = ptrsRef.current.values();
    lastPtRef.current = { x: only.x, y: only.y };
    kindRef.current = zoomRef.current > 1 ? "pan" : "idle";
  };

  if (!current) return null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="图片查看器"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 outline-none"
      onClick={() => {
        // 手势（拖动/捏合/滑动）结束后的 click 不关闭
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onClose();
      }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-5 top-5 z-30 p-1 text-white/70 transition hover:text-white"
        aria-label="关闭"
      >
        <X size={24} />
      </Button>

      {/* 工具栏：旋转 / 缩放 / 复位；z 高于图片，避免放大/拖动后被图盖住 */}
      <div
        className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-none border border-white/15 bg-stone-900/85 p-1 text-white"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          onClick={() => setRotation((r) => r - 90)}
          className="grid h-9 w-9 place-items-center hover:bg-white/10"
          aria-label="左旋 90°"
          title="左旋 90°"
        >
          <RotateCcw size={16} aria-hidden />
        </Button>
        <Button
          type="button"
          onClick={() => setRotation((r) => r + 90)}
          className="grid h-9 w-9 place-items-center hover:bg-white/10"
          aria-label="右旋 90°"
          title="右旋 90°"
        >
          <RotateCw size={16} aria-hidden />
        </Button>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <Button
          type="button"
          onClick={() => zoomTo(1 / 1.25)}
          className="grid h-9 w-9 place-items-center hover:bg-white/10"
          aria-label="缩小"
          title="缩小"
        >
          <Minus size={16} aria-hidden />
        </Button>
        <span className="grid h-9 w-9 select-none place-items-center text-xs tabular-nums text-white/70">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          onClick={() => zoomTo(1.25)}
          className="grid h-9 w-9 place-items-center hover:bg-white/10"
          aria-label="放大"
          title="放大"
        >
          <Plus size={16} aria-hidden />
        </Button>
        <span className="mx-1 h-5 w-px bg-white/15" />
        <Button
          type="button"
          onClick={reset}
          className="grid h-9 w-9 place-items-center hover:bg-white/10"
          aria-label="复位"
          title="复位"
        >
          <Maximize size={16} aria-hidden />
        </Button>
      </div>

      {multi && (
        <>
          <Button
            type="button"
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
          </Button>
          <Button
            type="button"
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
          </Button>
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
        className={`max-h-[92vh] max-w-full touch-none select-none object-contain ${
          gesturing ? "transition-none" : "transition-transform duration-150 ease-out"
        }`}
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px) rotate(${rotation}deg) scale(${zoom})`,
          cursor: zoom > 1 ? "grab" : "zoom-in",
        }}
      />
    </div>
  );
}
