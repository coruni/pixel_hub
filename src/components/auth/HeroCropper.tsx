"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/Button";

// 个人主页横幅裁剪器：导出 1600×500 webp。
// 弹窗结构照抄 AvatarCropper；裁剪框宽度照抄 HeroForm 预览区（aspect-[16/5] w-full），
// 随弹窗容器自适应，任何屏宽都不会横向溢出。逻辑坐标系 = 裁剪框实际像素，
// 由 ResizeObserver 测量，无需额外 UI 缩放。
// 交互：拖动平移 + 滚轮/滑杆缩放 + 双指捏合 + Esc/Enter 快捷键。

const OUT_W = 1600;
const OUT_H = 500;

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
  const [view, setView] = useState<View>({ w: 0, h: 0 }); // 裁剪框实际像素尺寸
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // 最新值 ref 镜像 + 手势状态机（同 ImageViewer：pointer 回调只读 ref，避免 state 闭包陈旧）
  const imgRef = useRef<HTMLImageElement | null>(null);
  const viewRef = useRef<View>({ w: 0, h: 0 });
  const zoomRef = useRef(1);
  const posRef = useRef<Pos>({ x: 0, y: 0 });
  const pointersRef = useRef<Map<number, Pos>>(new Map());
  const kindRef = useRef<"idle" | "pan" | "pinch">("idle");
  const lastPtRef = useRef<Pos>({ x: 0, y: 0 });
  const pinchRef = useRef<{ dist: number; zoom: number; pos: Pos; cx: number; cy: number } | null>(null);
  const initedRef = useRef(false); // 首张图的初始取景只做一次

  // 裁剪框完全被图覆盖时的最小缩放（cover，沿短边对齐）
  function coverScaleOf(el: HTMLImageElement, v: View) {
    if (v.w <= 0 || v.h <= 0) return 1;
    return Math.max(v.w / el.naturalWidth, v.h / el.naturalHeight);
  }
  const coverScale = img ? coverScaleOf(img, view) : 1;
  const scale = coverScale * zoom;
  const dw = img ? img.naturalWidth * scale : 0;
  const dh = img ? img.naturalHeight * scale : 0;

  // ref 镜像跟随 state
  useEffect(() => {
    imgRef.current = img;
  }, [img]);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  // 量取裁剪框实际尺寸（w-full aspect-[16/5]，宽度变化即高度成比例变化）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function measure(target: HTMLDivElement) {
      const w = Math.max(1, Math.round(target.getBoundingClientRect().width));
      // 高度按 16:5 严格换算（而非量 rect.height，避免取整引入比例失真导致导出拉伸）
      const h = Math.max(1, Math.round((w * OUT_H) / OUT_W));
      setView({ w, h });
    }
    measure(el);
    const ro = new ResizeObserver(() => {
      const t = containerRef.current;
      if (t) measure(t);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 初始取景：图片就绪且尺寸已知后，默认缩放 1、画面顶部对齐（横幅主体通常在图上方）
  function frameInitial(el: HTMLImageElement) {
    const v = viewRef.current;
    const c = coverScaleOf(el, v);
    const p = { x: (v.w - el.naturalWidth * c) / 2, y: (v.h - el.naturalHeight * c) / 2 };
    zoomRef.current = 1;
    posRef.current = p;
    setZoom(1);
    setPos(p);
  }

  useEffect(() => {
    if (!img || initedRef.current || view.w <= 0) return;
    initedRef.current = true;
    frameInitial(img);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- frameInitial 只读写 ref/稳定 setter，无陈旧闭包风险
  }, [img, view]);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      setImg(el);
      // 若尺寸已量好（弹窗先于图片就绪）直接取景
      if (viewRef.current.w > 0 && !initedRef.current) {
        initedRef.current = true;
        frameInitial(el);
      }
    };
    el.src = url;
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // 打开时锁定 body 滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // 同时写 state 与 ref 镜像：transform 状态的唯一写入入口
  function applyView(z: number, p: Pos) {
    const np = clampPos(p, z);
    zoomRef.current = z;
    posRef.current = np;
    setZoom(z);
    setPos(np);
  }

  function clampPos(p: Pos, z: number): Pos {
    const el = imgRef.current;
    const v = viewRef.current;
    if (!el || v.w <= 0) return p;
    const s = coverScaleOf(el, v) * z;
    const w = el.naturalWidth * s;
    const h = el.naturalHeight * s;
    return {
      x: Math.min(0, Math.max(v.w - w, p.x)),
      y: Math.min(0, Math.max(v.h - h, p.y)),
    };
  }

  // 以裁剪框内焦点 (focusX, focusY) 缩放：焦点处像素保持不动，画面围绕其放大/缩小
  function zoomTo(next: number, focusX?: number, focusY?: number) {
    const el = imgRef.current;
    const v = viewRef.current;
    if (!el || v.w <= 0) return;
    const z = Math.min(8, Math.max(1, next));
    const fx = focusX ?? v.w / 2;
    const fy = focusY ?? v.h / 2;
    const p = posRef.current;
    const k = z / zoomRef.current;
    applyView(z, { x: fx - (fx - p.x) * k, y: fy - (fy - p.y) * k });
  }

  function reset() {
    const el = imgRef.current;
    if (!el) return;
    frameInitial(el);
  }

  function confirm() {
    const el = imgRef.current;
    const v = viewRef.current;
    if (!el || busy || v.w <= 0) return;
    setBusy(true);
    const s = coverScaleOf(el, v) * zoomRef.current;
    const sx = -posRef.current.x / s;
    const sy = -posRef.current.y / s;
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

  // 键盘：Esc 取消 / Enter 确认
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

  // ---- pointer 手势（参考 ImageViewer 实现：单指平移 + 双指捏合）----
  // 状态存于 ref 镜像，pointer 事件经 JSX 绑定到裁剪框，值总是最新的，无 1 帧滞后

  function clientToLocal(cx: number, cy: number): Pos {
    // 逻辑坐标系 = 容器实际像素，直接做 rect 偏移换算
    const el = containerRef.current;
    if (!el) return { x: cx, y: cy };
    const rect = el.getBoundingClientRect();
    return { x: cx - rect.left, y: cy - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return; // 仅左键
    const pid = e.pointerId;
    pointersRef.current.set(pid, { x: e.clientX, y: e.clientY });
    const pts = [...pointersRef.current.values()];

    if (pts.length === 2) {
      // 第二根手指落下 → 进入捏合。只记录起点，后续按起点锚定计算，避免累积误差
      const [a, b] = pts;
      pinchRef.current = {
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom: zoomRef.current,
        pos: { ...posRef.current },
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
      kindRef.current = "pinch";
      return;
    }

    kindRef.current = "pan";
    lastPtRef.current = { x: e.clientX, y: e.clientY };
    // 鼠标/触控笔可能移出裁剪框，主动捕获；触摸有隐式捕获无需处理
    if (e.pointerType !== "touch") e.currentTarget.setPointerCapture(pid);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const pid = e.pointerId;
    if (!pointersRef.current.has(pid)) return;
    pointersRef.current.set(pid, { x: e.clientX, y: e.clientY });
    const pts = [...pointersRef.current.values()];

    if (kindRef.current === "pinch" && pts.length === 2) {
      const [a, b] = pts;
      const g = pinchRef.current;
      if (!g) return;
      const z = Math.min(8, Math.max(1, g.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist)));
      // 以捏合起始中心为锚缩放，中心再跟随两指中点平移（同 ImageViewer）
      const f0 = clientToLocal(g.cx, g.cy);
      const f1 = clientToLocal((a.x + b.x) / 2, (a.y + b.y) / 2);
      const k = z / g.zoom;
      applyView(z, { x: f1.x - k * (f0.x - g.pos.x), y: f1.y - k * (f0.y - g.pos.y) });
      return;
    }

    if (kindRef.current === "pan" && pts.length === 1) {
      const cur = { x: e.clientX, y: e.clientY };
      const dx = cur.x - lastPtRef.current.x;
      const dy = cur.y - lastPtRef.current.y;
      lastPtRef.current = cur;
      const p = posRef.current;
      applyView(zoomRef.current, { x: p.x + dx, y: p.y + dy });
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(e.pointerId);
    pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      kindRef.current = "idle";
      return;
    }
    // 捏合中抬起一指 → 剩余单指继续平移
    const [only] = [...pointersRef.current.values()];
    lastPtRef.current = { x: only.x, y: only.y };
    kindRef.current = "pan";
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.stopPropagation();
    zoomTo(zoomRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-label="主页横幅裁剪"
    >
      <div className="w-full max-w-sm rounded-none border border-brand-300 bg-surface p-5">
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

        {/* 裁剪框：宽度照抄 HeroForm 预览区 aspect-[16/5] w-full，随弹窗自适应，永不横向溢出 */}
        <div
          ref={containerRef}
          className="relative mx-auto w-full touch-none select-none overflow-hidden border border-brand-600 bg-brand-50"
          style={{ aspectRatio: "16 / 5", cursor: "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img.src}
              alt="待裁剪横幅"
              draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-w-none"
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
