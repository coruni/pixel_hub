"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/Button";

// 个人主页横幅裁剪器：16:5 视口（480×150 显示），导出 1600×500 webp。
// 与 AvatarCropper 同款交互：拖动平移 + 滚轮/滑杆缩放 + 双指捏合 + Esc/Enter 快捷键。

const VIEW_W = 480;
const VIEW_H = 150;
const OUT_W = 1600;
const OUT_H = 500;

type Pos = { x: number; y: number };

export default function HeroCropper({
  file,
  onCancel,
  onConfirm,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  // UI 缩放（让 VIEW_W 在窄屏内自适应）
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [uiScale, setUiScale] = useState(1);

  // 拖拽 / 多指
  const dragRef = useRef<{ sx: number; sy: number; pos: Pos } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDist: number; startZoom: number; startPos: Pos } | null>(null);

  // 视口完全被图覆盖时的最小缩放（cover，沿短边对齐）
  const coverScale = img ? Math.max(VIEW_W / img.naturalWidth, VIEW_H / img.naturalHeight) : 1;
  const scale = coverScale * zoom;
  const dw = img ? img.naturalWidth * scale : 0;
  const dh = img ? img.naturalHeight * scale : 0;

  useEffect(() => {
    function update() {
      const width = containerRef.current?.parentElement?.clientWidth ?? window.innerWidth;
      const maxWidth = Math.max(1, width - 32);
      setUiScale(Math.min(1, maxWidth / VIEW_W));
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      setImg(el);
      setZoom(1);
      // 顶部对齐（横幅主体通常在图上方区域）
      const c = Math.max(VIEW_W / el.naturalWidth, VIEW_H / el.naturalHeight);
      setPos({ x: (VIEW_W - el.naturalWidth * c) / 2, y: (VIEW_H - el.naturalHeight * c) / 2 });
    };
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 打开时锁定 body 滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function clampPos(p: Pos, z: number): Pos {
    const s = coverScale * z;
    const w = (img?.naturalWidth ?? 0) * s;
    const h = (img?.naturalHeight ?? 0) * s;
    return {
      x: Math.min(0, Math.max(VIEW_W - w, p.x)),
      y: Math.min(0, Math.max(VIEW_H - h, p.y)),
    };
  }

  function zoomTo(next: number, focusX = VIEW_W / 2, focusY = VIEW_H / 2) {
    const z = Math.min(8, Math.max(1, next));
    const ratio = z / zoom;
    const cx = focusX;
    const cy = focusY;
    setPos((p) => clampPos({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }, z));
    setZoom(z);
  }

  function reset() {
    setZoom(1);
    setPos({ x: (VIEW_W - dw) / 2, y: (VIEW_H - dh) / 2 });
  }

  function confirm() {
    if (!img || busy) return;
    setBusy(true);
    const s = coverScale * zoom;
    const sx = -pos.x / s;
    const sy = -pos.y / s;
    const sw = VIEW_W / s;
    const sh = VIEW_H / s;
    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
    canvas.toBlob(
      (b) => {
        if (!b) {
          setBusy(false);
          return;
        }
        if (b.type === "image/webp") onConfirm(b);
        else canvas.toBlob((pb) => (pb ? onConfirm(pb) : setBusy(false)), "image/png");
      },
      "image/webp",
      0.82,
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") {
        e.preventDefault();
        confirm();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, zoom, pos, busy]);

  // pointer handlers：支持单指拖动、两指捏合缩放
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function getClientPointers() {
      return Array.from(pointersRef.current.values());
    }

    function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.hypot(dx, dy);
    }

    function clientToLocal(cx: number, cy: number) {
      const rect = el.getBoundingClientRect();
      const x = (cx - rect.left) / uiScale;
      const y = (cy - rect.top) / uiScale;
      return { x, y };
    }

    function onPointerDown(e: PointerEvent) {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 1) {
        dragRef.current = { sx: e.clientX, sy: e.clientY, pos };
      } else if (pointersRef.current.size === 2) {
        const pts = getClientPointers();
        const dist = distance(pts[0], pts[1]);
        pinchRef.current = { startDist: dist, startZoom: zoom, startPos: pos };
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 1) {
        const d = dragRef.current;
        if (!d) return;
        setPos((p) =>
          clampPos({ x: d.pos.x + (e.clientX - d.sx), y: d.pos.y + (e.clientY - d.sy) }, zoom),
        );
      } else if (pointersRef.current.size === 2 && pinchRef.current) {
        const pts = getClientPointers();
        const newDist = distance(pts[0], pts[1]);
        const ratio = newDist / pinchRef.current.startDist;
        const nextZoom = Math.min(8, Math.max(1, pinchRef.current.startZoom * ratio));

        // 中心点
        const mX = (pts[0].x + pts[1].x) / 2;
        const mY = (pts[0].y + pts[1].y) / 2;
        const local = clientToLocal(mX, mY);
        zoomTo(nextZoom, local.x, local.y);
      }
    }

    function onPointerUp(e: PointerEvent) {
      pointersRef.current.delete(e.pointerId);
      pinchRef.current = null;
      dragRef.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        //
      }
    }

    el.addEventListener("pointerdown", onPointerDown as any);
    window.addEventListener("pointermove", onPointerMove as any);
    window.addEventListener("pointerup", onPointerUp as any);
    window.addEventListener("pointercancel", onPointerUp as any);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown as any);
      window.removeEventListener("pointermove", onPointerMove as any);
      window.removeEventListener("pointerup", onPointerUp as any);
      window.removeEventListener("pointercancel", onPointerUp as any);
    };
  }, [pos, zoom, uiScale, img]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-label="主页横幅裁剪"
    >
      <div className="w-full max-w-lg rounded-none border border-brand-300 bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-800">裁剪主页横幅</h3>
          <Button
            type="button"
            onClick={onCancel}
            aria-label="取消"
            className="grid h-7 w-7 place-items-center border border-brand-200 text-neutral-500 hover:border-brand-500 hover:text-neutral-900"
          >
            <X size={14} aria-hidden />
          </Button>
        </div>

        <div
          ref={containerRef}
          className="relative mx-auto touch-none select-none overflow-hidden border border-brand-600 bg-brand-50"
          style={{
            width: VIEW_W,
            height: VIEW_H,
            cursor: "grab",
            transformOrigin: "top left",
          }}
        >
          <div
            style={{
              width: VIEW_W,
              height: VIEW_H,
              transform: `scale(${uiScale})`,
              transformOrigin: "top left",
            }}
          >
            {img && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.src}
                alt="待裁剪横幅"
                draggable={false}
                className="pointer-events-none absolute left-0 top-0 origin-top-left max-w-none"
                style={{ width: dw, height: dh, transform: `translate(${pos.x}px, ${pos.y}px)` }}
              />
            )}
            {/* 三分线参考 */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button
            type="button"
            onClick={() => zoomTo(zoom / 1.25)}
            aria-label="缩小"
            className="grid h-8 w-8 shrink-0 place-items-center border border-brand-200 text-neutral-600 hover:border-brand-500"
          >
            <ZoomOut size={14} aria-hidden />
          </Button>
          <input
            type="range"
            min={1}
            max={8}
            step={0.01}
            value={zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
            className="h-1.5 min-w-0 flex-1 accent-brand-500"
            aria-label="缩放"
          />
          <Button
            type="button"
            onClick={() => zoomTo(zoom * 1.25)}
            aria-label="放大"
            className="grid h-8 w-8 shrink-0 place-items-center border border-brand-200 text-neutral-600 hover:border-brand-500"
          >
            <ZoomIn size={14} aria-hidden />
          </Button>
          <Button
            type="button"
            onClick={reset}
            aria-label="重置"
            className="grid h-8 w-8 shrink-0 place-items-center border border-brand-200 text-neutral-600 hover:border-brand-500"
          >
            <RotateCcw size={14} aria-hidden />
          </Button>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            onClick={onCancel}
            className="rounded-none border border-brand-200 bg-surface px-4 py-2 text-sm text-neutral-600 hover:border-brand-500"
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={confirm}
            disabled={!img || busy}
            className="inline-flex items-center gap-1.5 rounded-none border border-brand-600 bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            <Check size={14} aria-hidden /> {busy ? "处理中…" : "确认裁剪"}
          </Button>
        </div>
      </div>
    </div>
  );
}
