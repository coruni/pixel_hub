"use client";

/**
 * 音视频「字幕 / 歌词」的编辑抽屉 —— **一个播放项一份**，入口是 av-row 行尾那个图标按钮。
 *
 * 为什么收进抽屉：这个编辑器自带格式下拉、内容摘要、更换/清空两个动作、可展开的粘贴区，
 * 摊在列表行里会让每一行长高三倍 —— 而绝大多数曲目 / 分P 根本没挂字幕。
 * 抽屉**只在打开时挂载**（`open` 为 false 直接不渲染），那些行就只剩两行输入框的高度。
 *
 * 值仍是**受控**的：宿主持 `CaptionDraft | null`，这里只收 value / onChange，自己不渲染隐藏字段 ——
 * 字幕随 avTracks / avCaption 的 JSON 一起提交，两处各写一份必然漂移。
 * 受控还有一个必要理由：行可以增删，抽屉自己持 state 会在删中间一行时把字幕错位到别的曲目上。
 *
 * **不走上传通道**：文本直接读进内存、随 meta 落库（理由见 lib/captions.ts 的文件头）。
 * 所以这里没有上传进度、没有存储去向、也不会产生孤儿文件，只有两条入口 ——
 * 「拖入 / 选择文件读文本」与「粘贴文本」。
 *
 * 文本上限是**硬拒**而不是截断：截断产出的是时间轴错位的坏字幕，比干脆没有更难查。
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { FileText, Trash2, X } from "lucide-react";
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

/** 抽屉内的输入盒。不拼 wizInput：那一份带 w-full / px-3.5 / py-2.5，这里要更紧凑 */
const boxBase =
  "rounded-none border border-brand-200 bg-surface outline-none transition placeholder:text-neutral-400 focus:border-brand-500";

const CAPTION_ACCEPT = ".vtt,.srt,.lrc,.ass,.ssa,.txt";

export type CaptionDrawerProps = {
  open: boolean;
  /** 关闭回调。**必须是稳定引用**（宿主用 useCallback），否则本组件里的 effect 每次重渲染都重跑、反复抢焦点 */
  onClose: () => void;
  /** 面板标题，如「P1 的字幕」/「曲目 2 的歌词」 */
  title: string;
  avKind: AvKind;
  /** 本项的字幕；null = 这一项没挂 */
  value: CaptionDraft | null;
  onChange: (next: CaptionDraft | null) => void;
  fieldErrors?: Record<string, string[]>;
  /** 字段错误在扁平化后的键名（`caption` / `tracks.1.caption`） */
  errorKey?: string;
};

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

/** 关着时整个不渲染：抽屉内部 state（粘贴草稿、提示）随之丢弃，下次打开是干净的 */
export function CaptionDrawer(props: CaptionDrawerProps) {
  if (!props.open) return null;
  return <DrawerBody {...props} />;
}

function DrawerBody({
  onClose,
  title,
  avKind,
  value,
  onChange,
  fieldErrors,
  errorKey = "caption",
}: CaptionDrawerProps) {
  /** 正在粘贴编辑（false = 没展开） */
  const [pasting, setPasting] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const word = avKind === "audio" ? "歌词" : "字幕";
  const unit = avKind === "audio" ? "曲目" : "分P";
  const ext = avKind === "audio" ? ".lrc" : ".srt";

  // Esc 关闭 + 锁背景滚动 + 打开即把焦点收进面板：与站内其他弹层同一套行为
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

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
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/40" onClick={onClose} aria-hidden />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col rounded-none border-l border-brand-200 bg-panel shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-brand-200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-900">{title}</p>
            <p className="mt-0.5 text-[11px] leading-4 text-neutral-400">
              文本随资源一起保存，不用上传文件；随{unit}切换
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
            className="shrink-0 p-1 text-neutral-400 transition hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <X size={15} aria-hidden />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
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
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => fileRef.current?.click()}
                >
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
              className={`border-2 border-dashed px-4 py-8 text-center transition ${
                dragging ? "border-brand-500 bg-brand-50" : "border-brand-200 bg-surface"
              }`}
            >
              <FileText size={22} className="mx-auto text-neutral-400" aria-hidden />
              <p className="mt-2 text-sm text-neutral-700">
                把 {ext} / .vtt / .ass 文件拖到这里
              </p>
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
        </div>

        <footer className="border-t border-brand-200 p-4">
          <Button type="button" variant="primary" size="block" onClick={onClose}>
            完成
          </Button>
        </footer>

        <input
          ref={fileRef}
          type="file"
          accept={CAPTION_ACCEPT}
          onChange={onFileChange}
          className="hidden"
          tabIndex={-1}
          aria-hidden
        />
      </aside>
    </>
  );
}
