"use client";

/**
 * 字幕 / 歌词的展示层 —— 详情页的音视频播放器共用（音频卡片、视频浮层）。
 *
 * 数据来自当前播放项自己的 `caption`（主来源在 meta.caption，其余在 meta.tracks[].caption），
 * 随详情页内联下来，不发任何请求；解析在 `lib/captions.ts`。
 * **切播放项即换字幕**，没有「多轨切换」这回事 —— 作者想给某首曲子上歌词，就填在那一行里。
 *
 * 三块：
 *   `useAvCaption`    解析当前项那唯一一份字幕 + 开关（按 caption memo，别在每次 timeupdate 时重解析）
 *   `CaptionControls` 控件行 / 画面浮层上的开关
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
  AV_BTN_SIZE as SIZE,
  AV_TONE as TONE,
  type AvBtnSize,
  type AvTone,
} from "./av-btn";

/** 字幕的展示名（没有「第几条」了，就叫歌词 / 字幕） */
export function captionName(avKind: AvKind): string {
  return avKind === "audio" ? "歌词" : "字幕";
}

/**
 * 当前播放项的字幕状态。`on` 默认开 —— 作者既然给这一项挂了字幕，默认就该显示；
 * 关掉是「我读得懂原文，别挡画面」的少数情况，所以开关只关不记忆。
 * 切播放项时开关状态跟着延续（作者视角：我刚说了不要字幕）。
 */
export function useAvCaption(caption?: CaptionDraft) {
  const [off, setOff] = useState(false);
  // caption 来自服务端 props，引用稳定；只有切 P 时才换新对象
  const parsed = useMemo(
    () => (caption?.text.trim() ? parseCaption(caption.text, caption.format) : NO_CAPTION),
    [caption],
  );
  /** 这份字幕有没有实际内容（空文本 / 坏数据解析后可能啥都没有，那就不给它按钮） */
  const ready = parsed.cues.length > 0 || parsed.lines.length > 0;
  return {
    parsed,
    ready,
    on: ready && !off,
    toggle: () => setOff((v) => !v),
  };
}

/** 字幕 / 歌词开关 */
export function CaptionControls({
  on,
  name,
  tone,
  onToggle,
  size = "md",
}: {
  on: boolean;
  /** 展示名，进 aria-label 与 title */
  name: string;
  tone: AvTone;
  onToggle: () => void;
  size?: AvBtnSize;
}) {
  const text = on ? `关闭${name}` : `显示${name}`;
  return (
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
  );
}

/**
 * 视频字幕叠层。没有当前行（空档 / 关闭 / 播完）就整块不渲染，别留一条空条。
 * **不自己 `absolute`**：它是宿主「底部控件区」那一列（`flex-col justify-end`）里的一格，
 * 靠列顺序被顶在控件条上沿 —— 控件行窄屏折成两行、或分P 面板把这一列撑高，
 * 字幕都自动让得开（原来写 `bottom-full` 是假定「控件条就是这一列的最后一格」）。
 * `pointer-events-none`：看得见、点不到。它还在做淡出的那层**外面**：字幕是内容，不跟控件一起消失。
 */
export function CaptionLayer({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="pointer-events-none flex shrink-0 justify-center px-3 pb-2">
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
      className={`relative max-h-56 overflow-y-auto rounded-none border border-brand-300 bg-brand-50/70 p-1.5 ${className ?? ""}`}
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
