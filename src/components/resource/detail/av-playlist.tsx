"use client";

/**
 * 音视频「分P / 曲目」列表 UI —— 详情页三种播放形态共用（音频卡片、视频浮层、嵌入页）。
 *
 * 抽出来的原因：三处的列表长得一样、文案规则一样（音频=曲目 / 视频=分P），
 * 各写一遍必然只改到其中一处；这里只负责「展示 + 回调」，当前播到第几 P 由宿主持有。
 *
 * tone 与播放器控件同一套（见 lib/ui/cls.ts）：onDark = 压在视频画面上，onSurface = 落在暖白卡片里。
 */

import type { CSSProperties, ReactNode } from "react";
import { ListMusic, SkipBack, SkipForward } from "lucide-react";
import { avItemLabel, avStepLabel, type AvPlayItem } from "@/lib/av-tracks";
import type { AvKind } from "@/lib/av";
import {
  AV_BTN as BTN,
  AV_BTN_HEIGHT,
  AV_BTN_SIZE as SIZE,
  AV_TONE as TONE,
  type AvBtnSize,
  type AvTone,
} from "./av-btn";

export type { AvTone };

/** 上一曲/下一曲（音频）、上一集/下一集（视频）；到边界即禁用，不做循环 */
export function AvStepButton({
  dir,
  avKind,
  index,
  count,
  onGo,
  tone,
  size = "md",
  className,
}: {
  dir: -1 | 1;
  avKind: AvKind;
  index: number;
  count: number;
  onGo: (next: number) => void;
  tone: AvTone;
  size?: AvBtnSize;
  className?: string;
}) {
  const label = avStepLabel(avKind, dir);
  const next = index + dir;
  const disabled = next < 0 || next >= count;
  return (
    <button
      type="button"
      onClick={() => onGo(next)}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`${BTN} ${SIZE[size]} ${TONE[tone].off} disabled:cursor-not-allowed disabled:opacity-40 ${
        className ?? ""
      }`}
    >
      {dir < 0 ? <SkipBack size={size === "lg" ? 20 : 16} aria-hidden /> : <SkipForward size={size === "lg" ? 20 : 16} aria-hidden />}
    </button>
  );
}

/** 列表开关（图标 + 「3/8」计数），点击展开/收起分P 列表 */
export function AvListToggle({
  open,
  index,
  count,
  tone,
  onToggle,
  size = "md",
  className,
}: {
  open: boolean;
  index: number;
  count: number;
  tone: AvTone;
  onToggle: () => void;
  size?: AvBtnSize;
  className?: string;
}) {
  const label = open ? "收起列表" : "展开列表";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      title={label}
      // 宽度自适应：`SIZE` 里写死了 w-9/w-11，而这个按钮里既要放图标又要放「3/8」，
      // 固定宽度会让文本溢出容器、和相邻按钮视觉重叠。高度仍与方形按钮对齐（见 av-btn.tsx）。
      className={`inline-flex ${AV_BTN_HEIGHT[size]} shrink-0 items-center justify-center gap-1 rounded-none px-1.5 transition focus-visible:ring-2 focus-visible:ring-brand-400 ${
        open ? TONE[tone].on : TONE[tone].off
      } ${className ?? ""}`}
    >
      <ListMusic size={16} aria-hidden />
      <span className="text-xs tabular-nums">
        {index + 1}/{count}
      </span>
    </button>
  );
}

/**
 * 分P 列表本体。整行是一个按钮（点标题即切换），当前项加底色 + `aria-current`。
 * 列表可能很长（上限 60），容器限高并自己滚动，避免把视频浮层撑出画面。
 *
 * **限高由宿主用 class 给**（视频铺满画面、音频/嵌入页 45vh），组件不再自带默认值 ——
 * 内联 maxHeight 会压过宿主的响应式 class，视频那种「窄屏贴底铺满 / 宽屏右下浮层」就写不出来。
 * `header` 是可选槽位（标题 + 收起按钮）：它不能塞进 `<ol>`（ol 只允许 li），所以外面套一层 flex 容器。
 */
export function AvTrackList({
  items,
  index,
  avKind,
  tone,
  onPick,
  className,
  style,
  header,
}: {
  items: AvPlayItem[];
  index: number;
  avKind: AvKind;
  tone: AvTone;
  onPick: (next: number) => void;
  className?: string;
  /** 宿主确实需要按运行期算高度时才用内联；能写成 class 就写 class */
  style?: CSSProperties;
  /** 列表头（标题 / 收起按钮），由宿主给 */
  header?: ReactNode;
}) {
  const dark = tone === "onDark";
  return (
    <div
      style={style}
      className={`flex flex-col overflow-hidden rounded-none border ${
        dark ? "border-white/20 bg-black/85" : "border-brand-300 bg-surface"
      } ${className ?? ""}`}
    >
      {header}
      <ol
        className={`min-h-0 flex-1 overflow-y-auto ${
          dark ? "" : "divide-y-2 divide-dashed divide-brand-300"
        }`}
      >
        {items.map((it, i) => {
          const active = i === index;
          // 行线：亮色分支由 <ol> 的 divide-y-2 divide-dashed 统一画虚线，逐行不再加边框；
          // 暗色分支压在视频画面上，是固定深底，走白色半透明实线（不参与主题与调色）。
          return (
            <li
              key={`${i}-${it.url}`}
              className={dark ? "border-b border-white/10 last:border-b-0" : undefined}
            >
              <button
                type="button"
                onClick={() => onPick(i)}
                aria-current={active ? "true" : undefined}
                className={`flex min-h-9 w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition ${
                  active
                    ? dark
                      ? "bg-brand-500/35 text-white"
                      : "bg-brand-100 text-brand-800"
                    : dark
                      ? "text-white/85 hover:bg-white/10"
                      : "text-neutral-700 hover:bg-brand-50"
                }`}
              >
                <span className={`w-6 shrink-0 tabular-nums ${dark ? "text-white/55" : "text-neutral-400"}`}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{avItemLabel(it, i, avKind)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
