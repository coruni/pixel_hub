"use client";

/**
 * 音视频「字幕 / 歌词」字段 —— **一个播放项一份**，由播放项设置抽屉（av-item-drawer.tsx）承载。
 *
 * 原本和抽屉外壳挤在同一个文件里（caption-drawer.tsx）。拆开的理由：抽屉行为（Esc / 遮罩 /
 * 锁滚动 / 焦点回流 / 页脚）与字幕本身的解析、嗅探、摘要计算是两件独立的事，后者还带着一份
 * 「别跟着每次按键重解析 160KB 文本」的性能讲究，混在一起谁都读不清。
 *
 * 值仍是**受控**的：宿主持 `CaptionDraft | null`，这里只收 value / onChange，自己不渲染隐藏字段 ——
 * 字幕随 avTracks / avCaption 的 JSON 一起提交，两处各写一份必然漂移。
 * 受控还有一个必要理由：行可以增删，这里自持 state 会在删中间一行时把字幕错位到别的曲目上。
 *
 * **不走上传通道**：文本直接读进内存、随 meta 落库（理由见 lib/captions.ts 的文件头）。
 * 所以没有上传进度、没有存储去向、也不会产生孤儿文件，只有两条入口 ——
 * 「拖入 / 选择文件读文本」与「粘贴文本」。
 *
 * 文本上限是**硬拒**而不是截断：截断产出的是时间轴错位的坏字幕，比干脆没有更难查。
 */

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { FileText, Trash2 } from "lucide-react";
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
import { useFileDrop } from "@/lib/hooks/use-file-drop";
import { Button } from "@/components/ui/Button";
import { fieldErr, wizLabel } from "./wizard-shared";

/** 输入盒。不拼 wizInput：那一份带 w-full / px-3.5 / py-2.5，这里要更紧凑 */
const boxBase =
  "rounded-none border border-brand-200 bg-surface outline-none transition placeholder:text-neutral-400 focus:border-brand-500";

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
  errorKey = "caption",
}: {
  avKind: AvKind;
  /** 本项的字幕；null = 这一项没挂 */
  value: CaptionDraft | null;
  onChange: (next: CaptionDraft | null) => void;
  fieldErrors?: Record<string, string[]>;
  /** 字段错误在扁平化后的键名（`caption` / `tracks.1.caption`） */
  errorKey?: string;
}) {
  /** 正在粘贴编辑（false = 没展开） */
  const [pasting, setPasting] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const word = avKind === "audio" ? "歌词" : "字幕";
  const unit = avKind === "audio" ? "曲目" : "分P";
  const ext = avKind === "audio" ? ".lrc" : ".srt";

  const { dragging, dropProps } = useFileDrop({
    onFiles: (files) => {
      const file = files[0];
      if (file) void loadFile(file);
    },
  });

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
    setPasting(false);
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
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        {/* 不写 `${wizLabel} mb-0`：wizLabel 自带 mb-1，那是同一组属性并存、靠产物顺序定胜负 */}
        <span className="block text-sm font-medium text-neutral-700">{word}</span>
        <span className="text-[11px] text-neutral-400">随{unit}切换，文本随资源一起保存</span>
      </div>

      {has && value ? (
        <>
          <label className="block">
            <span className={wizLabel}>格式</span>
            <select
              value={value.format}
              onChange={(e) => onChange({ ...value, format: e.target.value as CaptionFormat })}
              className={`${boxBase} mt-1.5 w-full px-2.5 py-2 text-sm`}
            >
              {CAPTION_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {CAPTION_FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
          </label>

          <p className="flex items-center gap-1.5 border border-brand-100 bg-brand-50/40 px-3 py-2 text-xs text-neutral-600">
            <FileText size={13} className="shrink-0" aria-hidden />
            <span className="truncate">
              <CaptionStats caption={value} />
            </span>
          </p>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="xs" onClick={() => fileRef.current?.click()}>
              更换文件
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                setPasting(true);
                setDraftText(value.text);
                setNote(null);
              }}
            >
              粘贴编辑
            </Button>
            <Button
              type="button"
              variant="dangerGhost"
              size="xs"
              onClick={() => {
                onChange(null);
                setPasting(false);
                setNote(null);
              }}
            >
              <Trash2 size={13} aria-hidden />
              清空
            </Button>
          </div>
        </>
      ) : (
        <div
          {...dropProps}
          className={`border-2 border-dashed px-4 py-6 text-center transition ${
            dragging ? "border-brand-500 bg-brand-50" : "border-brand-200 bg-surface"
          }`}
        >
          <FileText size={22} className="mx-auto text-neutral-400" aria-hidden />
          <p className="mt-2 text-sm text-neutral-700">把 {ext} / .vtt / .ass 文件拖到这里</p>
          <p className="mt-1 text-[11px] leading-4 text-neutral-400">
            也可以点下面按钮选择，或直接粘贴文本
          </p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="mt-3"
            onClick={() => fileRef.current?.click()}
          >
            选择文件
          </Button>
        </div>
      )}

      {pasting && (
        <div>
          <span className={wizLabel}>粘贴{word}文本</span>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={12}
            spellCheck={false}
            aria-label={`粘贴${word}文本`}
            placeholder={`把 ${ext} / .vtt / .ass 的内容原样贴进来`}
            className={`${boxBase} mt-1.5 w-full px-3 py-2 text-xs`}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="primary" size="xs" onClick={applyPaste}>
              应用
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                setPasting(false);
                setDraftText("");
              }}
            >
              取消
            </Button>
          </div>
        </div>
      )}

      {note && (
        <p className={`text-xs leading-5 ${note.bad ? "text-red-600" : "text-amber-600"}`}>
          {note.text}
        </p>
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
