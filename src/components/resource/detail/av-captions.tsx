"use client";

/**
 * 字幕 / 歌词的展示层 —— 详情页的音视频播放器共用（音频卡片、视频浮层）。
 *
 * 数据来自 `meta.captions`（随详情页内联下来，不发任何请求），解析在 `lib/captions.ts`。
 * 三块：
 *   `useAvCaptions`   选轨 + 开关 + 解析（按轨 memo，别在每次 timeupdate 时重解析）
 *   `CaptionControls` 控件行 / 画面浮层上的开关（多轨时多一个循环切轨的小按钮）
 *   `CaptionLayer`    视频：压在画面底部的字幕叠层
 *   `LyricsPanel`     音频：卡片内的滚动歌词板（当前行高亮、点击跳转、自动居中）
 *
 * 音频把时间轴字幕当歌词看：同一份 cue 数据，只是排版从「叠层」换成「可滚动列表」。
 * 两条渲染路径都不走原生 `<track>`，原因见 lib/captions.ts 的文件头。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Subtitles } from "lucide-react";
import {
  activeCueIndex,
  NO_CAPTION,
  parseCaption,
  type CaptionDraft,
  type ParsedCaption,
} from "@/lib/captions";
import type { AvKind } from "@/lib/av";
import {
  AV_BTN as BTN,
  AV_BTN_HEIGHT,
  AV_BTN_SIZE as SIZE,
  AV_TONE as TONE,
  type AvBtnSize,
  type AvTone,
} from "./av-btn";

/** 轨道展示名：作者填了就用，没填按类型回退「歌词 / 字幕」（多轨才带序号） */
export function captionName(
  caption: CaptionDraft | undefined,
  index: number,
  count: number,
  avKind: AvKind,
): string {
  const named = caption?.label.trim();
  if (named) return named;
  const base = avKind === "audio" ? "歌词" : "字幕";
  return count > 1 ? `${base} ${index + 1}` : base;
}

/**
 * 字幕轨状态。`on` 默认开 —— 作者既然传了字幕，默认就该显示；
 * 关掉是「我读得懂原文，别挡画面」的少数情况，所以开关只关不记忆。
 */
export function useAvCaptions(captions: CaptionDraft[]) {
  const [index, setIndex] = useState(0);
  const [on, setOn] = useState(true);
  // captions 是服务端来的固定数组，但 idx 越界会在取 current 时炸，夹一下更稳
  const at = Math.min(index, Math.max(0, captions.length - 1));
  const current = captions[at];
  const parsed = useMemo(
    () => (current ? parseCaption(current.text, current.format) : NO_CAPTION),
    [current],
  );
  return {
    count: captions.length,
    index: at,
    current,
    parsed,
    on: on && captions.length > 0,
    toggle: () => setOn((v) => !v),
    cycle: () => setIndex((i) => (captions.length > 0 ? (i + 1) % captions.length : 0)),
  };
}

/** 字幕 / 歌词开关；多轨且开启时并排一个「2/3」循环切轨按钮 */
export function CaptionControls({
  on,
  index,
  count,
  name,
  tone,
  onToggle,
  onCycle,
  size = "md",
}: {
  on: boolean;
  index: number;
  count: number;
  /** 当前轨展示名，进 aria-label 与 title（切轨是循环的，得让用户知道现在在哪条） */
  name: string;
  tone: AvTone;
  onToggle: () => void;
  onCycle: () => void;
  size?: AvBtnSize;
}) {
  const text = on ? `关闭${name}` : `显示${name}`;
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        aria-label={text}
        title={text}
        className={`${BTN} ${SIZE[size]} ${on ? TONE[tone].on : TONE[tone].off}`}
      >
        <Subtitles size={16} aria-hidden />
      </button>
      {count > 1 && on && (
        <button
          type="button"
          onClick={onCycle}
          aria-label={`切换到下一条字幕（当前 ${name}）`}
          title={`切换到下一条字幕（当前 ${name}）`}
          // 序号与分P 列表开关同款：一眼看出「有几条、现在是第几条」
          className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-none px-1.5 text-xs tabular-nums transition focus-visible:ring-2 focus-visible:ring-brand-400 ${AV_BTN_HEIGHT[size]} ${TONE[tone].off}`}
        >
          {index + 1}/{count}
        </button>
      )}
    </span>
  );
}

/** 视频字幕叠层。没有当前行（空档 / 关闭 / 播完）就整块不渲染，别留一条空条 */
export function CaptionLayer({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-3 sm:bottom-16">
      <p
        className="max-w-[92%] whitespace-pre-line rounded-none bg-black/65 px-2 py-1 text-center text-sm leading-snug text-white sm:text-base"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,.9)" }}
      >
        {text}
      </p>
    </div>
  );
}

/**
 * 歌词板（音频）。
 *
 * 自动居中**手算 scrollTop**，不用 `scrollIntoView` —— 后者会把整个页面一起滚下去，
 * 用户正看着歌词，页面自己往上跳。动效跟随 `prefers-reduced-motion`。
 * 无时间轴（纯文本歌词）时不参与跟播：不高亮、不滚动、不可点。
 */
export function LyricsPanel({
  parsed,
  active,
  onSeek,
  className,
}: {
  parsed: ParsedCaption;
  /** 当前行下标；-1 = 空档（不跟播时为 -1） */
  active: number;
  onSeek?: (sec: number) => void;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const timed = parsed.cues.length > 0;

  useEffect(() => {
    const box = boxRef.current;
    if (!box || active < 0) return;
    const row = box.querySelector<HTMLElement>(`[data-cue="${active}"]`);
    if (!row) return;
    const top = row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }, [active]);

  return (
    <div
      ref={boxRef}
      className={`relative max-h-56 overflow-y-auto rounded-none border border-brand-200 bg-brand-50/70 p-1.5 ${className ?? ""}`}
    >
      {timed ? (
        <ol>
          {parsed.cues.map((cue, i) => (
            <li key={`${i}-${cue.start}`}>
              <button
                type="button"
                data-cue={i}
                onClick={() => onSeek?.(cue.start)}
                aria-current={i === active ? "true" : undefined}
                className={`block w-full whitespace-pre-line rounded-none px-2 py-1.5 text-left text-sm leading-snug transition ${
                  i === active
                    ? "bg-brand-200 font-semibold text-brand-900"
                    : "text-neutral-600 hover:bg-brand-100 hover:text-brand-800"
                }`}
              >
                {cue.text}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="px-2 py-1">
          {parsed.lines.map((line, i) => (
            <li key={i} className="whitespace-pre-line py-0.5 text-sm leading-relaxed text-neutral-600">
              {line}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** 供宿主算「此刻该显示哪一行」；关闭或无时间轴时恒 -1（叠层与歌词板都据此收摊） */
export function cueAt(parsed: ParsedCaption, time: number, enabled: boolean): number {
  if (!enabled || parsed.cues.length === 0) return -1;
  return activeCueIndex(parsed.cues, time);
}
