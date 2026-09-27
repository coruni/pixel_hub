"use client";

/**
 * 音视频播放器的直角滑块（进度条 / 音量条）—— 从 av-controls 里拆出来的独立职责：
 * 它只认「0..1 的比例」与回调，不碰媒体元素，播放器的状态机与它无关。
 *
 * 4px 轨道 + 3×12px 方形游标，指针拖动 + 键盘（←→ 5%、Home/End）。
 * `live` 为真时拖动过程即时回调（音量）；否则松手才回调（进度条，避免拖动中反复 seek）。
 */

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

export default function Bar({
  ratio,
  buffer = 0,
  onScrub,
  label,
  live,
  tone,
  className,
}: {
  ratio: number;
  buffer?: number;
  onScrub: (r: number) => void;
  label: string;
  live?: boolean;
  tone: "onDark" | "onSurface";
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = Math.min(1, Math.max(0, drag ?? ratio));
  const c =
    tone === "onDark"
      ? { track: "bg-white/25", buf: "bg-white/40", fill: "bg-brand-500", knob: "bg-white" }
      : { track: "bg-neutral-200", buf: "bg-neutral-300", fill: "bg-brand-500", knob: "bg-brand-700" };

  const ratioAt = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
  }, []);

  const stopDrag = () => {
    draggingRef.current = false;
    setDrag(null);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        const v = ratioAt(e.clientX);
        setDrag(v);
        if (live) onScrub(v);
      }}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        const v = ratioAt(e.clientX);
        setDrag(v);
        if (live) onScrub(v);
      }}
      onPointerUp={(e: PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        const v = ratioAt(e.clientX);
        stopDrag();
        onScrub(v);
      }}
      onPointerCancel={stopDrag}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        let next: number | null = null;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") next = shown + 0.05;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = shown - 0.05;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = 1;
        if (next === null) return;
        e.preventDefault();
        onScrub(Math.min(1, Math.max(0, next)));
      }}
      className={`relative flex cursor-pointer touch-none items-center py-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
        className ?? ""
      }`}
    >
      <span className={`relative h-1 w-full overflow-hidden ${c.track}`}>
        {buffer > 0 && (
          <span
            className={`absolute inset-y-0 left-0 ${c.buf}`}
            style={{ width: `${Math.min(1, buffer) * 100}%` }}
          />
        )}
        <span className={`absolute inset-y-0 left-0 ${c.fill}`} style={{ width: `${shown * 100}%` }} />
      </span>
      <span
        className={`pointer-events-none absolute top-1/2 h-3 w-[3px] ${c.knob}`}
        style={{ left: `${shown * 100}%`, transform: "translate(-50%, -50%)" }}
      />
    </div>
  );
}
