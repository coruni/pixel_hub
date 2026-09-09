"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/Button";

// 头像裁剪器：方形视口，拖动平移 + 滚轮/滑杆缩放 + 双指捏合，导出 256×256。

const VIEW = 288; // 裁剪视口边长（显示像素）
const OUT = 256; // 导出边长

type Pos = { x: number; y: number };

export default function AvatarCropper({
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

  // UI 缩放（将固定 VIEW 缩放到窄屏）
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [uiScale, setUiScale] = useState(1);

  // 最新值 ref 镜像 + 手势状态机（同 ImageViewer：pointer 回调只读 ref，避免 state 闭包陈旧）
  const imgRef = useRef<HTMLImageElement | null>(null);
  const zoomRef = useRef(1);
  const posRef = useRef<Pos>({ x: 0, y: 0 });
  const pointersRef = useRef<Map<number, Pos>>(new Map());
  const kindRef = useRef<"idle" | "pan" | "pinch">("idle");
  const lastPtRef = useRef<Pos>({ x: 0, y: 0 });
  const pinchRef = useRef<{ dist: number; zoom: number; pos: Pos; cx: number; cy: number } | null>(null);

  // 视口完全被图覆盖时的最小缩放（cover）
  function coverScaleOf(el: HTMLImageElement) {
    return VIEW / Math.min(el.naturalWidth, el.naturalHeight);
  }
  const coverScale = img ? coverScaleOf(img) : 1;
  const scale = coverScale * zoom;
  const dw = img ? img.naturalWidth * scale : 0;
  const dh = img ? img.naturalHeight * scale : 0;

  // ref 镜像跟随 state（图片加载 / 按钮 / 滑杆 / 手势任一路径都会同步）
  useEffect(() => {
    imgRef.current = img;
  }, [img]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  useLayoutEffect(() => {
    // 计算 uiScale：让固定 VIEW 在窄屏内显示（左右 padding 由 modal 决定）。
    // 用 layout effect 在绘制前收敛，避免首帧以全宽 288px 渲染撑破小屏 modal
    function update() {
      const width = containerRef.current?.parentElement?.clientWidth ?? window.innerWidth;
      const maxWidth = Math.max(1, width - 40); // 卡片 p-5 左右 padding 共 40px
      setUiScale(Math.min(1, maxWidth / VIEW));
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
      // 居中
      const c = VIEW / Math.min(el.naturalWidth, el.naturalHeight);
      setPos({ x: (VIEW - el.naturalWidth * c) / 2, y: (VIEW - el.naturalHeight * c) / 2 });
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
    if (!el) return p;
    const s = coverScaleOf(el) * z;
    const w = el.naturalWidth * s;
    const h = el.naturalHeight * s;
    return { x: Math.min(0, Math.max(VIEW - w, p.x)), y: Math.min(0, Math.max(VIEW - h, p.y)) };
  }

  // 以裁剪视口内焦点 (focusX, focusY) 缩放：焦点处像素保持不动，画面围绕其放大/缩小
  function zoomTo(next: number, focusX = VIEW / 2, focusY = VIEW / 2) {
    const el = imgRef.current;
    if (!el) return;
    const z = Math.min(8, Math.max(1, next));
    const p = posRef.current;
    const k = z / zoomRef.current;
    applyView(z, { x: focusX - (focusX - p.x) * k, y: focusY - (focusY - p.y) * k });
  }

  function reset() {
    const el = imgRef.current;
    if (!el) return;
    const c = coverScaleOf(el);
    applyView(1, { x: (VIEW - el.naturalWidth * c) / 2, y: (VIEW - el.naturalHeight * c) / 2 });
  }

  function confirm() {
    if (!img || busy) return;
    setBusy(true);
    const s = coverScale * zoom;
    const sx = -pos.x / s;
    const sy = -pos.y / s;
    const sw = VIEW / s;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sw, 0, 0, OUT, OUT);
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
      0.92,
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
    // 页面坐标 → 裁剪框内逻辑坐标（÷ uiScale，UI 缩放只影响显示不影响构图）
    const el = containerRef.current;
    if (!el) return { x: cx / uiScale, y: cy / uiScale };
    const rect = el.getBoundingClientRect();
    return { x: (cx - rect.left) / uiScale, y: (cy - rect.top) / uiScale };
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
      const dx = (cur.x - lastPtRef.current.x) / uiScale;
      const dy = (cur.y - lastPtRef.current.y) / uiScale;
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
      aria-label="头像裁剪"
    >
      <div className="w-full max-w-sm rounded-none border border-brand-300 bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-800">裁剪头像</h3>
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
            // 外层容器占位跟随 uiScale 收缩（内层已 scale(uiScale)），
            // 否则固定 288px 会把小屏卡片撑破、modal 横向溢出
            width: VIEW * uiScale,
            height: VIEW * uiScale,
            cursor: "grab",
            transformOrigin: "top left",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <div
            style={{
              width: VIEW,
              height: VIEW,
              transform: `scale(${uiScale})`,
              transformOrigin: "top left",
            }}
          >
            {img && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.src}
                alt="待裁剪头像"
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
