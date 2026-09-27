"use client";

/**
 * 音视频「字幕 / 歌词」编辑框 —— **一个播放项一份**，由 av-row.tsx 渲染在每一行下面。
 *
 * 与改造前的区别：以前是「整份资源共用、最多 N 条」的列表编辑器，有自己的 state 与隐藏字段；
 * 现在字幕和播放项一一对应（切曲目即切歌词），所以这里退化成**受控单项**：
 * 值从宿主（av-section 的行 state）来，变化回调回去，**自己不渲染隐藏字段** ——
 * 字幕随 avTracks / avCaption 的 JSON 一起提交，两处各写一份隐藏字段必然漂移。
 * 受控还有一个必要理由：行可以增删，用自己的 state 会在删中间一行时把字幕错位到别的曲目上。
 *
 * **不走上传通道**：文本直接读进内存、随 meta 落库（理由见 lib/captions.ts 的文件头）。
 * 所以这里没有上传进度、没有存储去向、也不会产生孤儿文件，只有两条入口 ——
 * 「选择文件读文本」与「粘贴文本」。
 *
 * 文本上限是**硬拒**而不是截断：截断产出的是时间轴错位的坏字幕，比干脆没有更难查。
 */

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { ClipboardPaste, FileText, Trash2 } from "lucide-react";
import {
  captionFormatOfName,
  captionSummary,
  CAPTION_FORMAT_LABEL,
  CAPTION_FORMATS,
  AV_CAPTION_TEXT_MAX,
  parseCaption,
  sniffCaptionFormat,
  type CaptionDraft,
  type CaptionFormat,
} from "@/lib/captions";
import type { AvKind } from "@/lib/av";
import { formatBytes } from "@/lib/format";
import { fieldErr } from "./wizard-shared";
import { Button } from "@/components/ui/Button";

// 盒子自己写而不是拼 wizInput / wizBtn：那一对带着 w-full / px-3 py-2 / text-sm，
// 再追加 w-auto / px-2 / text-xs 会出现**同组属性并存**，最终谁生效取决于 Tailwind 产物的顺序，
// 不可靠（本仓库吃过这个亏）。这里按每种控件的实际尺寸各写一条。
const boxBase =
  "rounded-none border border-brand-200 bg-surface outline-none transition placeholder:text-neutral-400 focus:border-brand-500";
const btnSm = "inline-flex items-center justify-center gap-1.5 rounded-none border px-2.5 py-1.5 text-xs transition";
const btnNeutral = `${btnSm} border-brand-200 bg-surface text-neutral-600 hover:border-brand-400 hover:text-brand-700`;
const btnPrimary = `${btnSm} border-brand-600 bg-brand-500 text-white hover:bg-brand-600`;
const btnIcon = `${btnSm} border-brand-200 bg-surface px-2 text-neutral-500 hover:border-red-300 hover:text-red-600`;

const CAPTION_ACCEPT = ".vtt,.srt,.lrc,.ass,.ssa,.txt";

/** 已载入内容的摘要：行数 / 时长覆盖 / 体积。**按文本 memo** —— 160KB 的字幕解析一次要几毫秒，
 *  跟着每次按键重解析会把输入框拖卡。 */
function CaptionStats({ caption }: { caption: CaptionDraft }) {
  const info = useMemo(() => {
    const parsed = parseCaption(caption.text, caption.format);
    const bytes = new Blob([caption.text]).size;
    return `${captionSummary(parsed)} · ${formatBytes(bytes)}`;
  }, [caption.text, caption.format]);
  return <>{info}</>;
}

export function CaptionField({
  avKind,
  value,
  onChange,
  fieldErrors,
  /** 字段错误在扁平化后的键名（`caption` / `tracks.1.caption`） */
  errorKey = "caption",
}: {
  avKind: AvKind;
  /** 本项的字幕；null = 这一项没挂 */
  value: CaptionDraft | null;
  onChange: (next: CaptionDraft | null) => void;
  fieldErrors?: Record<string, string[]>;
  errorKey?: string;
}) {
  /** 正在粘贴编辑（false = 没展开） */
  const [pasting, setPasting] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const word = avKind === "audio" ? "歌词" : "字幕";

  /** 长度校验：超限返回提示文案，通过返回 null */
  function tooLong(text: string): string | null {
    if (text.length <= AV_CAPTION_TEXT_MAX) return null;
    const limit = AV_CAPTION_TEXT_MAX.toLocaleString("en-US");
    return `${word}文本过长（${text.length.toLocaleString("en-US")} 字符，上限 ${limit} 字符）`;
  }

  async function loadFile(file: File) {
    const text = await file.text().catch(() => "");
    if (!text.trim()) {
      setNote({ text: `${file.name} 读不出文本内容（可能不是纯文本文件）`, bad: true });
      return;
    }
    const bad = tooLong(text);
    if (bad) {
      setNote({ text: bad, bad: true });
      return;
    }
    // 后缀认不出时按内容嗅探，别让作者手选一个错格式
    const format = captionFormatOfName(file.name) ?? sniffCaptionFormat(text);
    onChange({ format, text });
    setNote({ text: `已载入 ${file.name}（识别为 ${CAPTION_FORMAT_LABEL[format]}）` });
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 清空 value：否则选同一个文件第二次不会触发 change
    e.target.value = "";
    if (file) void loadFile(file);
  }

  function applyPaste() {
    if (!draftText.trim()) {
      setNote({ text: "粘贴内容为空", bad: true });
      return;
    }
    const bad = tooLong(draftText);
    if (bad) {
      setNote({ text: bad, bad: true });
      return;
    }
    const format = sniffCaptionFormat(draftText);
    onChange({ format, text: draftText });
    setNote({ text: `已应用粘贴内容（识别为 ${CAPTION_FORMAT_LABEL[format]}）` });
    setPasting(false);
    setDraftText("");
  }

  const has = !!value?.text.trim();

  return (
    <div className="rounded-none border border-brand-100 bg-brand-50/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-xs text-neutral-500">{word}</span>
        {has && value ? (
          <>
            <select
              value={value.format}
              onChange={(e) => onChange({ ...value, format: e.target.value as CaptionFormat })}
              aria-label={`${word}格式`}
              className={`${boxBase} shrink-0 px-2 py-1 text-xs`}
            >
              {CAPTION_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {CAPTION_FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
            <span className="inline-flex min-w-0 items-center gap-1 text-xs text-neutral-500">
              <FileText size={12} className="shrink-0" aria-hidden />
              <span className="truncate">
                <CaptionStats caption={value} />
              </span>
            </span>
            <span className="flex-1" />
            <Button type="button" onClick={() => fileRef.current?.click()} className={btnNeutral}>
              更换
            </Button>
            <Button
              type="button"
              onClick={() => {
                setPasting(true);
                setDraftText(value.text);
                setNote(null);
              }}
              className={btnNeutral}
            >
              粘贴编辑
            </Button>
            <Button
              type="button"
              onClick={() => onChange(null)}
              aria-label={`清空${word}`}
              className={btnIcon}
            >
              <Trash2 size={13} aria-hidden />
            </Button>
          </>
        ) : (
          <>
            <span className="text-[11px] text-neutral-400">未挂载</span>
            <span className="flex-1" />
            <Button type="button" onClick={() => fileRef.current?.click()} className={btnNeutral}>
              <FileText size={13} aria-hidden />
              选择文件
            </Button>
            <Button
              type="button"
              onClick={() => {
                setPasting(true);
                setDraftText("");
                setNote(null);
              }}
              className={btnNeutral}
            >
              <ClipboardPaste size={13} aria-hidden />
              粘贴文本
            </Button>
          </>
        )}
      </div>

      {pasting && (
        <div className="mt-2">
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={6}
            spellCheck={false}
            aria-label={`粘贴${word}文本`}
            placeholder={`把 ${avKind === "audio" ? ".lrc" : ".srt"} / .vtt 的内容原样贴进来`}
            className={`${boxBase} w-full px-3 py-2 text-xs`}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" onClick={applyPaste} className={btnPrimary}>
              应用
            </Button>
            <Button
              type="button"
              onClick={() => {
                setPasting(false);
                setDraftText("");
              }}
              className={btnNeutral}
            >
              取消
            </Button>
          </div>
        </div>
      )}

      {note && (
        <p className={`mt-1.5 text-xs ${note.bad ? "text-red-600" : "text-amber-600"}`}>{note.text}</p>
      )}
      {fieldErr(fieldErrors?.[errorKey])}

      <input
        ref={fileRef}
        type="file"
        accept={CAPTION_ACCEPT}
        onChange={onFileChange}
        className="hidden"
        tabIndex={-1}
        aria-hidden
      />
    </div>
  );
}
