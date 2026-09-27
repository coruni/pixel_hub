"use client";

/**
 * 音视频「字幕 / 歌词」编辑区 —— 发布向导与后台改稿共用（契约与 av-section 一致：
 * 自己持有 state、自己渲染隐藏字段、由宿主塞进同一个 form）。
 *
 * **不走上传通道**：文本直接读进内存、随 meta 落库（理由见 lib/captions.ts 的文件头）。
 * 所以这里没有上传进度、没有存储去向、也不会产生孤儿文件，只有两条入口 ——
 * 「选择文件读文本」与「粘贴文本」。
 *
 * 文本上限是**硬拒**而不是截断：截断产出的是时间轴错位的坏字幕，比干脆没有更难查。
 */

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { ClipboardPaste, FileText, Plus, Trash2 } from "lucide-react";
import {
  captionFormatOfName,
  captionSummary,
  CAPTION_FORMAT_LABEL,
  CAPTION_FORMATS,
  AV_CAPTION_TEXT_MAX,
  AV_CAPTIONS_MAX,
  parseCaption,
  serializeAvCaptions,
  sniffCaptionFormat,
  type CaptionDraft,
  type CaptionFormat,
} from "@/lib/captions";
import type { AvKind } from "@/lib/av";
import { formatBytes } from "@/lib/format";
import { fieldErr, wizBtn, wizInput, wizLabel } from "./wizard-shared";
import { Button } from "@/components/ui/Button";

const btnSm = `${wizBtn} border-brand-200 bg-surface px-2.5 py-1.5 text-xs text-neutral-600 hover:border-brand-400 hover:text-brand-700`;

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

export function CaptionSection({
  avKind,
  initial,
  fieldErrors,
}: {
  avKind: AvKind;
  initial?: CaptionDraft[];
  fieldErrors?: Record<string, string[]>;
}) {
  const [list, setList] = useState<CaptionDraft[]>(() =>
    (initial ?? []).map((c) => ({ label: c.label ?? "", format: c.format, text: c.text ?? "" })),
  );
  /** 正在粘贴编辑的那一条（null = 没展开） */
  const [pasteAt, setPasteAt] = useState<number | null>(null);
  const [draftText, setDraftText] = useState("");
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  // 一个共享的文件选择器：点「选择文件」时先记住要填哪一条，onChange 里再取
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fileSlotRef = useRef<number | null>(null);

  const word = avKind === "audio" ? "歌词" : "字幕";

  const patch = (i: number, next: Partial<CaptionDraft>) =>
    setList((prev) => prev.map((c, j) => (j === i ? { ...c, ...next } : c)));

  function add() {
    if (list.length >= AV_CAPTIONS_MAX) {
      setNote({ text: `最多 ${AV_CAPTIONS_MAX} 条${word}`, bad: true });
      return;
    }
    setNote(null);
    // 默认格式按类型给：音乐多是 lrc，视频多是 srt
    setList((prev) => [...prev, { label: "", format: avKind === "audio" ? "lrc" : "srt", text: "" }]);
  }

  function remove(i: number) {
    setList((prev) => prev.filter((_, j) => j !== i));
    setPasteAt(null);
    setNote(null);
  }

  /** 长度校验：超限返回提示文案，通过返回 null */
  function tooLong(text: string): string | null {
    if (text.length <= AV_CAPTION_TEXT_MAX) return null;
    const limit = AV_CAPTION_TEXT_MAX.toLocaleString("en-US");
    return `${word}文本过长（${text.length.toLocaleString("en-US")} 字符，上限 ${limit} 字符）`;
  }

  async function loadFile(i: number, file: File) {
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
    const autoLabel = file.name.replace(/\.[^.]+$/, "").slice(0, 60);
    setList((prev) =>
      prev.map((c, j) =>
        j === i ? { ...c, text, format, label: c.label.trim() ? c.label : autoLabel } : c,
      ),
    );
    setNote({ text: `已载入 ${file.name}（识别为 ${CAPTION_FORMAT_LABEL[format]}）` });
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 清空 value：否则选同一个文件第二次不会触发 change
    e.target.value = "";
    const i = fileSlotRef.current;
    fileSlotRef.current = null;
    if (file && i !== null) void loadFile(i, file);
  }

  function pickFile(i: number) {
    fileSlotRef.current = i;
    setNote(null);
    fileRef.current?.click();
  }

  function openPaste(i: number, text: string) {
    setPasteAt(i);
    setDraftText(text);
    setNote(null);
  }

  function applyPaste() {
    if (pasteAt === null) return;
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
    patch(pasteAt, { text: draftText, format });
    setNote({ text: `已应用粘贴内容（识别为 ${CAPTION_FORMAT_LABEL[format]}）` });
    setPasteAt(null);
    setDraftText("");
  }

  return (
    <div>
      <span className={wizLabel}>{word}（可选）</span>
      <p className="mb-2 text-[11px] leading-4 text-neutral-400">
        支持 VTT / SRT / LRC / ASS（只取时间与文本，样式与特效丢弃）/ TXT（无时间轴，只作静态文本）。
        {avKind === "audio" ? "音频显示为滚动歌词，点行可跳转。" : "视频叠在画面上。"}
        整份资源共用一份，不按{avKind === "audio" ? "曲目" : "分P"}分；嵌入页播放时不生效。
      </p>

      {list.length > 0 && (
        <ul className="space-y-3">
          {list.map((c, i) => (
            <li key={i} className="rounded-none border border-brand-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={c.label}
                  onChange={(e) => patch(i, { label: e.target.value })}
                  maxLength={60}
                  placeholder={`${word}名称（可留空）`}
                  aria-label={`第 ${i + 1} 条${word}的名称`}
                  className={`${wizInput} min-w-0 flex-1`}
                />
                <select
                  value={c.format}
                  onChange={(e) => patch(i, { format: e.target.value as CaptionFormat })}
                  aria-label={`第 ${i + 1} 条${word}的格式`}
                  className={`${wizInput} w-auto`}
                >
                  {CAPTION_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {CAPTION_FORMAT_LABEL[f]}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`删除第 ${i + 1} 条${word}`}
                  className="rounded-none border border-brand-200 p-2.5 text-neutral-500 hover:border-red-300 hover:text-red-600"
                >
                  <Trash2 size={15} />
                </Button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {c.text.trim() ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                      <FileText size={12} aria-hidden />
                      <CaptionStats caption={c} />
                    </span>
                    <Button type="button" onClick={() => pickFile(i)} className={btnSm}>
                      更换文件
                    </Button>
                    <Button type="button" onClick={() => openPaste(i, c.text)} className={btnSm}>
                      粘贴编辑
                    </Button>
                    <Button type="button" onClick={() => patch(i, { text: "" })} className={btnSm}>
                      清空
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" onClick={() => pickFile(i)} className={btnSm}>
                      <FileText size={13} aria-hidden />
                      选择文件
                    </Button>
                    <Button type="button" onClick={() => openPaste(i, "")} className={btnSm}>
                      <ClipboardPaste size={13} aria-hidden />
                      粘贴文本
                    </Button>
                    <span className="text-[11px] text-neutral-400">{CAPTION_ACCEPT}</span>
                  </>
                )}
              </div>

              {pasteAt === i && (
                <div className="mt-2">
                  <label className={wizLabel} htmlFor={`capText${i}`}>
                    粘贴{word}文本
                  </label>
                  <textarea
                    id={`capText${i}`}
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={6}
                    spellCheck={false}
                    placeholder="把 .srt / .lrc / .vtt 的内容原样贴进来"
                    className={`${wizInput} text-xs`}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={applyPaste}
                      className={`${btnSm} border-brand-600 bg-brand-500 text-white hover:bg-brand-600`}
                    >
                      应用
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        setPasteAt(null);
                        setDraftText("");
                      }}
                      className={btnSm}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={add}
          className={`${wizBtn} border-brand-200 bg-surface text-neutral-600 hover:border-brand-400 hover:text-brand-700`}
        >
          <Plus size={14} aria-hidden />
          添加{word}
        </Button>
        <span className="text-[11px] text-neutral-400">
          最多 {AV_CAPTIONS_MAX} 条（多语言 / 多版本）
        </span>
      </div>

      {note && (
        <p className={`mt-1.5 text-xs ${note.bad ? "text-red-600" : "text-amber-600"}`}>{note.text}</p>
      )}
      {fieldErr(fieldErrors?.captions)}
      {fieldErr(fieldErrors?.["captions.0.text"])}

      {/* 受控序列化（与 avTracks 同款）：没载入文本的行不提交，服务端按 avMetaSchema.captions 再校验 */}
      <input type="hidden" name="avCaptions" value={serializeAvCaptions(list)} />
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
