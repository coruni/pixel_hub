"use client";

/**
 * 单个「播放项」编辑行 —— 曲目 / 分P 一行一个（由 av-section 渲染列表，发布向导与后台改稿共用）。
 *
 * 一行只有两层：**编号 · 标题 · 字幕入口 · 删除** / **地址 + 上传按钮**。
 * 字幕 / 歌词编辑器不摊在行里（它自带格式下拉、摘要、两个动作与可展开的粘贴区，
 * 摊开会让每行长高三倍），收进行尾按钮点开的抽屉（见 caption-drawer.tsx）——
 * 绝大多数曲目根本不挂字幕，不该为它们付出那三倍高度。
 *
 * 地址与文件是**同一个字段**：可以手粘链接，也可以点框里的上传按钮，上传完把站内地址回填进来 ——
 * 不再有「上传模式」这种需要作者先声明一次的选项（两种来源落库结果本来就是同一个 URL）。
 * 同时**整行都是拖放区**（把文件拖到这一行上即可），上传期间行内显示百分比进度条。
 *
 * 标题从上传的文件名取（见 lib/av.ts 的 avTitleFromFile）：只在作者还没自己填、或填的正是上一次
 * 自动值时才写入 —— 手改过的标题绝不被后一次上传覆盖。
 *
 * 字幕跟行走的取舍见 lib/meta.ts 的 avTrackSchema：切曲目即切歌词，没有「多轨切换」的概念。
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Loader, Music2, Subtitles, Trash2, UploadCloud } from "lucide-react";
import {
  avAcceptAttr,
  avExtsSample,
  avMountPlaceholder,
  avTitleFromFile,
  type AvKind,
} from "@/lib/av";
import type { CaptionDraft } from "@/lib/captions";
import { formatBytes } from "@/lib/format";
import { useFileDrop } from "@/lib/hooks/use-file-drop";
import { uploadAttachment } from "@/lib/upload-attachment-client";
import { Button } from "@/components/ui/Button";
import { CaptionDrawer } from "./caption-drawer";
import { fieldErr, wizInputSm } from "./wizard-shared";

/** 编辑器里的播放项。`id` 是行身份：行会增删，用下标当 key 会让字幕编辑器的内部态错位到别的曲目 */
export type AvPlayRow = {
  id: string;
  title: string;
  url: string;
  caption: CaptionDraft | null;
};

let seq = 0;

/**
 * 新行的 id。初始行由调用方按序号命名（`r0`、`r1`…，服务端与客户端渲染一致，不会 hydration 打架），
 * 这里只服务「用户点添加」这种纯客户端路径。
 */
export function newRowId(): string {
  seq += 1;
  return `n${seq}`;
}

/** 行尾图标按钮（字幕入口 / 删除）：与输入框同高，不是 44px 触控目标，但要够得着 */
const rowIconBtn =
  "relative shrink-0 rounded-none border p-1.5 transition focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-60";

export function AvRowEditor({
  row,
  label,
  avKind,
  unit,
  limits,
  /** 主来源行（第一行）：地址 / 标题进 form 具名字段，且上传后由宿主抽帧当封面 */
  isMain = false,
  /** 列表里不止这一行（决定删除按钮是「删除」还是「清空」，见宿主 remove） */
  canRemove = true,
  /** 地址 / 标题的 form 字段名（仅主来源行传；其余行走 avTracks JSON） */
  urlName,
  titleName,
  fieldErrors,
  /** 本行字幕在扁平化错误对象里的键：主来源 `caption`，其余 `tracks.{i}.caption` */
  captionErrorKey,
  onPatch,
  onRemove,
  onUploaded,
  onBusy,
}: {
  row: AvPlayRow;
  /** 展示名，如「曲目 1」/「P1」 */
  label: string;
  avKind: AvKind;
  /** 分P 的统称（音频=曲目，视频=分P） */
  unit: string;
  limits: { attachmentMaxMb: number };
  isMain?: boolean;
  canRemove?: boolean;
  urlName?: string;
  titleName?: string;
  fieldErrors?: Record<string, string[]>;
  captionErrorKey: string;
  onPatch: (patch: Partial<AvPlayRow>) => void;
  onRemove: () => void;
  onUploaded?: (file: File) => void;
  onBusy?: (id: string, busy: boolean) => void;
}) {
  const isAudio = avKind === "audio";
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [capOpen, setCapOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const capBtnRef = useRef<HTMLButtonElement | null>(null);
  // 上传中不允许再拖入（与文件选择器的 disabled 语义对齐）；**抽屉开着时也要关掉**——
  // 抽屉是 fixed 定位但仍挂在 <li> 的 DOM 子树里，往抽屉里拖字幕文件时 drop 会冒泡上来，
  // 不关的话同一个 .srt 既会被读成字幕、又会被当成视频上传。
  const { dragging, dropProps } = useFileDrop({
    onFiles: (f) => void onFile(f[0] ?? null),
    disabled: uploading || capOpen,
  });

  // 上次**自动**填进去的标题。用来分辨「这个标题是自动来的，可以覆盖」还是「作者手改过，不许动」——
  // 光看 row.title 分不出来（自动值也是普通字符串）。上传是异步的，作者可能在传输期间改标题，
  // 所以标题也放进 ref 读最新值，不能只信 onFile 闭包里的那份。
  const autoTitleRef = useRef("");
  const titleRef = useRef(row.title);
  useEffect(() => {
    titleRef.current = row.title;
  }, [row.title]);

  // 在飞上传同步给宿主，供提交按钮禁用（与 AttachmentListEditor 同契约）
  useEffect(() => {
    onBusy?.(row.id, uploading);
  }, [uploading, onBusy, row.id]);

  /** 关抽屉并把焦点还给入口按钮（键盘流不断）。传进抽屉的必须是稳定引用，否则抽屉的 effect 会重跑 */
  const closeCaption = useCallback(() => {
    setCapOpen(false);
    capBtnRef.current?.focus();
  }, []);

  async function onFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setPercent(0);
    setMsg(null);
    try {
      const done = await uploadAttachment(file, setPercent, isAudio ? "music" : "video");
      const patch: Partial<AvPlayRow> = { url: done.url };
      // 标题从文件名取：空着就填，填的是上次自动值也覆盖（换文件 → 标题跟着换）；
      // 作者手改过则原样保留 —— 自动填充是省事，不是替作者决定标题。
      const auto = avTitleFromFile(file.name);
      const cur = titleRef.current;
      if (auto && (!cur.trim() || cur === autoTitleRef.current)) {
        patch.title = auto;
        autoTitleRef.current = auto;
      }
      onPatch(patch);
      setMsg(`已上传 ${done.name}（${formatBytes(done.size)}）`);
      // 抽帧交给宿主（只对主来源有意义，视频才有画面可抽）
      onUploaded?.(file);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : `${isAudio ? "音频" : "视频"}上传失败，请重试`);
    } finally {
      setUploading(false);
      setPercent(null);
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 清空 value：否则选同一个文件第二次不会触发 change
    e.target.value = "";
    void onFile(file ?? null);
  }

  /** 上传按钮不必展示 accept 串，但把上限写进 title，作者点之前就能判断该不该压缩 */
  const uploadHint = `上传${isAudio ? "音频" : "视频"}文件（单文件 ≤ ${limits.attachmentMaxMb} MB，支持 ${avExtsSample(avKind, 4)}）`;

  const word = isAudio ? "歌词" : "字幕";
  const hasCaption = !!row.caption?.text.trim();
  const CapIcon = isAudio ? Music2 : Subtitles;

  return (
    <li
      {...dropProps}
      className={`border p-2 ${
        dragging ? "border-brand-500 bg-brand-50" : "border-brand-200 bg-surface"
      }`}
    >
      {/* 第 1 层：编号 · 标题 · 字幕入口 · 删除 —— 挤在一行，行高就是输入框高 */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs tabular-nums text-neutral-500">
          {label}
          {isMain && <span className="ml-1 text-[11px] text-neutral-400">主来源</span>}
        </span>
        <input
          value={row.title}
          name={titleName}
          onChange={(e) => onPatch({ title: e.target.value })}
          maxLength={120}
          placeholder={`${unit}标题（可留空）`}
          aria-label={`${label}的标题`}
          className={`${wizInputSm} flex-1`}
        />
        <button
          ref={capBtnRef}
          type="button"
          onClick={() => setCapOpen(true)}
          aria-haspopup="dialog"
          aria-label={hasCaption ? `编辑 ${label} 的${word}` : `为 ${label} 添加${word}`}
          title={hasCaption ? `${word}：已挂载（点开编辑）` : `添加${word}`}
          className={`${rowIconBtn} ${
            hasCaption
              ? "border-brand-500 bg-brand-50 text-brand-700 hover:bg-brand-100"
              : "border-brand-200 bg-surface text-neutral-500 hover:border-brand-400 hover:text-brand-700"
          }`}
        >
          <CapIcon size={15} aria-hidden />
          {/* 已挂载除颜色外加一个角标：状态不靠颜色单独表达 */}
          {hasCaption && (
            <span className="absolute -right-0.5 -top-0.5 block h-1.5 w-1.5 bg-brand-500" aria-hidden />
          )}
        </button>
        <Button
          type="button"
          onClick={onRemove}
          /* 只剩一行时宿主只清空不删除（列表总得留一行给作者填地址），文案跟着变 */
          aria-label={canRemove ? `删除${label}` : `清空${label}`}
          className={`${rowIconBtn} border-brand-200 bg-surface text-neutral-500 hover:border-red-300 hover:text-red-600`}
        >
          <Trash2 size={14} aria-hidden />
        </Button>
      </div>

      {/* 第 2 层：地址 + 内嵌上传按钮 */}
      <div className="mt-1.5 flex min-w-0 items-stretch">
        <input
          value={row.url}
          name={urlName}
          onChange={(e) => {
            onPatch({ url: e.target.value });
            if (msg) setMsg(null);
          }}
          maxLength={2000}
          placeholder={avMountPlaceholder(avKind)}
          aria-label={`${label}的地址`}
          className={`${wizInputSm} flex-1`}
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          aria-label={uploadHint}
          title={uploadHint}
          /* 紧贴输入框右侧的图标按钮：与输入框共用一条边框（-ml-px），所以不走 Button 的尺寸轴 ——
             它的 px-3 会和这里的 px-2.5 撞在同一组属性上，谁生效取决于产物顺序。 */
          className="-ml-px inline-flex shrink-0 items-center justify-center rounded-none border border-brand-200 bg-surface px-2.5 text-sm text-neutral-500 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-60"
        >
          {uploading ? (
            <Loader size={15} className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <UploadCloud size={15} aria-hidden />
          )}
        </Button>
      </div>

      {uploading && (
        <div
          className="mt-1.5 h-1 w-full bg-brand-100"
          role="progressbar"
          aria-label="上传进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? 0}
        >
          <div className="h-full bg-brand-500 transition-[width]" style={{ width: `${percent ?? 0}%` }} />
        </div>
      )}
      {msg && <p className="mt-1.5 text-xs text-amber-600">{msg}</p>}
      {isMain && fieldErr(fieldErrors?.title)}
      {isMain && fieldErr(fieldErrors?.url)}

      <CaptionDrawer
        open={capOpen}
        onClose={closeCaption}
        title={`${label} 的${word}`}
        avKind={avKind}
        value={row.caption}
        onChange={(c) => onPatch({ caption: c })}
        fieldErrors={fieldErrors}
        errorKey={captionErrorKey}
      />

      <input
        ref={fileRef}
        type="file"
        accept={avAcceptAttr(avKind)}
        onChange={onFileChange}
        className="hidden"
        tabIndex={-1}
        aria-hidden
      />
    </li>
  );
}
