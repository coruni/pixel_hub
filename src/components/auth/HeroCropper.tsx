"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/Button";

// 个人主页横幅裁剪器：16:5 出口（导出 1600×500 webp）。
// 显示视口自适应容器宽度（封顶 480px，高度随 16:5），移动端不溢出；
// 与 AvatarCropper 同款交互：拖动平移 + 滚轮/滑杆缩放 + Esc/Enter 快捷键。
// 坐标/裁剪数学全部基于"当前显示尺寸"（viewRef），导出尺寸固定 OUT_W×OUT_H。

const MAX_W = 480; // 显示视口宽度上限（PC 端与旧版一致）
const OUT_W = 1600;
const OUT_H = 500;
const RATIO = OUT_W / OUT_H; // 16:5

type Pos = { x: number; y: number };
type View = { w: number; h: number };

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
  const [view, setView] = useState<View>({ w: MAX_W, h: Math.round(MAX_W / RATIO) });
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; pos: Pos } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // refs 镜像：resize 回调 / 手势回调里需要最新值，避免 setState 闭包错位
  const imgRef = useRef<HTMLImageElement | null>(null);
  const zoomRef = useRef(1);
  const viewRef = useRef<View>(view);

  const coverScaleOf = (el: HTMLImageElement, v: View) =>
    Math.max(v.w / el.naturalWidth, v.h / el.naturalHeight);

  /** 平移边界：图需完整盖住视口 */
  function clampPos(p: Pos, z: number, v: View = viewRef.current): Pos {
    const el = imgRef.current;
    if (!el) return p;
    const s = coverScaleOf(el, v) * z;
    const w = el.naturalWidth * s;
    const h = el.naturalHeight * s;
    return {
      x: Math.min(0, Math.max(v.w - w, p.x)),
      y: Math.min(0, Math.max(v.h - h, p.y)),
    };
  }

  // 载入图片：封面铺满视口，居中开始
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      const v = viewRef.current;
      const c = coverScaleOf(el, v);
      imgRef.current = el;
      zoomRef.current = 1;
      setImg(el);
      setZoom(1);
      setPos({ x: (v.w - el.naturalWidth * c) / 2, y: (v.h - el.naturalHeight * c) / 2 });
    };
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 视口宽度跟随容器（ResizeObserver：旋转/分栏/窗口变化均触发）；等比换算平移，保持构图不跳
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const w = Math.max(120, Math.min(MAX_W, wrap.clientWidth));
      const prev = viewRef.current;
      if (w === prev.w) return;
      const k = w / prev.w;
      const next: View = { w, h: Math.round(w / RATIO) };
      viewRef.current = next;
      setView(next);
      setPos((p) => clampPos({ x: p.x * k, y: p.y * k }, zoomRef.current, next));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  // 打开时锁定 body 滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function zoomTo(next: number) {
    const z = Math.min(8, Math.max(1, next));
    const ratio = z / zoomRef.current;
    const v = viewRef.current;
    const cx = v.w / 2;
    const cy = v.h / 2;
    setPos((p) => clampPos({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }, z));
    zoomRef.current = z;
    setZoom(z);
  }

  function reset() {
    const el = imgRef.current;
    const v = viewRef.current;
    if (!el) return;
    const c = coverScaleOf(el, v);
    zoomRef.current = 1;
    setZoom(1);
    setPos({
      x: (v.w - el.naturalWidth * c) / 2,
      y: (v.h - el.naturalHeight * c) / 2,
    });
  }

  function confirm() {
    const el = imgRef.current;
    if (!el || busy) return;
    setBusy(true);
    const v = viewRef.current;
    const s = coverScaleOf(el, v) * zoomRef.current;
    const sx = -pos.x / s;
    const sy = -pos.y / s;
    const sw = v.w / s;
    const sh = v.h / s;
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
    ctx.drawImage(el, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
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

  const scale = img ? coverScaleOf(img, view) * zoom : 1;
  const dw = img ? img.naturalWidth * scale : 0;
  const dh = img ? img.naturalHeight * scale : 0;

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

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 sm:p-4"
      role="dialog"
      aria-label="主页横幅裁剪"
    >
      <div className="w-full max-w-lg rounded-none border border-brand-300 bg-surface p-4 sm:p-5">
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

        {/* 16:5 视口：宽度自适应容器（wrapRef 决定显示宽，视图不溢出屏幕） */}
        <div ref={wrapRef} className="w-full">
          <div
            className="relative mx-auto touch-none select-none overflow-hidden border border-brand-600 bg-brand-50"
            style={{ width: view.w, height: view.h, cursor: "grab" }}
            onPointerDown={(e) => {
              if (!img) return;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              dragRef.current = { sx: e.clientX, sy: e.clientY, pos };
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d) return;
              setPos(
                clampPos({ x: d.pos.x + (e.clientX - d.sx), y: d.pos.y + (e.clientY - d.sy) }, zoomRef.current),
              );
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            onWheel={(e) => {
              e.preventDefault();
              zoomTo(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
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
            onClick={() => zoomTo(zoomRef.current / 1.25)}
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
            onClick={() => zoomTo(zoomRef.current * 1.25)}
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
