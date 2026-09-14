"use client";

// 面积折线图（后台概览专用）—— 支持 hover / 键盘查看逐点数值。
//
// 交互设计：
//   · 鼠标在图上水平移动 → 取最近的 X 点，画竖直准线与各系列标记点，读数条同步显示该点全部系列的数值
//   · 键盘：图表可聚焦，←/→ 逐点移动、Home/End 跳首尾、Esc 取消（状态变化不依赖 hover）
//   · 读数条高度固定，取值不引起布局跳动
//
// 视觉与 charts.tsx 保持一致：颜色走 Tailwind token + currentColor，折线走直角（无曲线插值），
// 面积用同色低透明度纯色填充；SVG 以 preserveAspectRatio="none" 拉伸，配 non-scaling-stroke 保描边像素。
// 系列数值另有视觉隐藏表格，供屏幕阅读器与「不用鼠标也要能拿到数据」的场景使用。

import { useId, useState } from "react";
import { TONE_BG, type Tone } from "./charts";

const W = 700;
const H = 100;
const PAD = 6;

const TONE_STROKE: Record<Tone, string> = {
  brand: "text-brand-500",
  sky: "text-sky-500",
  emerald: "text-emerald-500",
  amber: "text-amber-500",
  red: "text-red-500",
  neutral: "text-neutral-400",
};

export function LineArea({
  title,
  labels,
  lines,
}: {
  title: string;
  labels: string[];
  lines: { label: string; values: number[]; tone: Tone }[];
}) {
  const n = labels.length;
  const [idx, setIdx] = useState<number | null>(null);
  const hintId = useId();

  const all = lines.flatMap((l) => l.values).map((v) => (Number.isFinite(v) ? v : 0));
  const max = Math.max(1, ...all);
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - PAD - ((Number.isFinite(v) ? v : 0) / max) * (H - PAD * 2);
  const points = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const valueAt = (values: number[], i: number) => values[i] ?? 0;
  const aria = `${title}：${lines
    .map((l) => `${l.label} ${l.values.join("、")}`)
    .join("；")}（${labels.join("、")}）`;

  // 从鼠标横向位置换算最近的 X 点（图表被拉伸铺满容器，故按容器宽度比例取整）
  function pick(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 1 || n < 1) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    setIdx(Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1)))));
  }

  function onKey(e: React.KeyboardEvent<SVGSVGElement>) {
    if (n === 0) return;
    const cur = idx ?? 0;
    if (e.key === "ArrowRight") setIdx(Math.min(n - 1, cur + (idx === null ? 0 : 1)));
    else if (e.key === "ArrowLeft") setIdx(Math.max(0, cur - (idx === null ? 0 : 1)));
    else if (e.key === "Home") setIdx(0);
    else if (e.key === "End") setIdx(n - 1);
    else if (e.key === "Escape") setIdx(null);
    else return;
    e.preventDefault();
  }

  return (
    <div>
      {/* 图例 + 峰值 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
        {lines.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 ${TONE_BG[l.tone]}`} aria-hidden />
            {l.label}
            <span className="tabular-nums text-neutral-400">
              合计 {l.values.reduce((s, v) => s + v, 0).toLocaleString()}
            </span>
          </span>
        ))}
        <span className="ml-auto tabular-nums text-neutral-400">峰值 {max.toLocaleString()}</span>
      </div>

      {/* 读数条：固定高度，hover / 键盘选点时显示该 X 点全部系列数值 */}
      <p
        id={hintId}
        className="mt-1 h-4 truncate text-[11px] leading-4 text-neutral-500"
        aria-live="polite"
      >
        {idx === null ? (
          <span className="text-neutral-400">悬停或聚焦后用 ←/→ 查看逐日数值</span>
        ) : (
          <span className="tabular-nums">
            <span className="text-neutral-400">{labels[idx]}</span>
            {lines.map((l) => (
              <span key={l.label} className="ml-2.5 inline-flex items-center gap-1">
                <span className={`inline-block h-2 w-2 ${TONE_BG[l.tone]}`} aria-hidden />
                {l.label}
                <span className="font-medium text-neutral-900">
                  {valueAt(l.values, idx).toLocaleString()}
                </span>
              </span>
            ))}
          </span>
        )}
      </p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={aria}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setIdx(null)}
        className="mt-2 h-28 w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        {[1, 0.5, 0].map((r) => (
          <line
            key={r}
            x1={0}
            x2={W}
            y1={y(max * r)}
            y2={y(max * r)}
            className="text-neutral-200"
            stroke="currentColor"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* 准线（画在面积之下，避免遮挡折线） */}
        {idx !== null && n > 0 && (
          <line
            x1={x(idx)}
            x2={x(idx)}
            y1={0}
            y2={H}
            className="text-neutral-400"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {lines.map((l) => (
          <g key={l.label} className={TONE_STROKE[l.tone]}>
            <path
              d={`${points(l.values)} L${W},${H} L0,${H} Z`}
              fill="currentColor"
              opacity={0.12}
            />
            <path
              d={points(l.values)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="miter"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}

        {/* 选中点标记：拉伸后仍以描边保证可视 */}
        {idx !== null &&
          lines.map((l) => (
            <circle
              key={l.label}
              cx={x(idx)}
              cy={y(valueAt(l.values, idx))}
              r={3}
              className={TONE_STROKE[l.tone]}
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}

        {/* 透明命中层：覆盖整个绘图区，只负责把鼠标位置换算成点索引 */}
        <rect
          x={0}
          y={0}
          width={W}
          height={H}
          fill="transparent"
          onMouseMove={pick}
          onMouseLeave={() => setIdx(null)}
        />
      </svg>

      <div className="relative mt-1 h-3 text-[10px] leading-none text-neutral-400">
        {labels.map((l, i) => (
          <span
            key={`${l}-${i}`}
            className={`absolute tabular-nums ${
              i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2"
            } ${idx === i ? "font-semibold text-neutral-700" : ""}`}
            style={{ left: `${n <= 1 ? 50 : (i / (n - 1)) * 100}%` }}
          >
            {l}
          </span>
        ))}
      </div>

      {/* 视觉隐藏数据表：键盘 / 屏幕阅读器同样能拿到逐点数值 */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">时间</th>
            {lines.map((l) => (
              <th key={l.label} scope="col">
                {l.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={`${l}-${i}`}>
              <th scope="row">{l}</th>
              {lines.map((s) => (
                <td key={s.label}>{valueAt(s.values, i)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
