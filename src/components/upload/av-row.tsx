"use client";

/**
 * 单个「播放项」编辑行 —— 曲目 / 分P 一行一个（由 av-section 渲染列表，发布向导与后台改稿共用）。
 *
 * 一行 = 编号 | 标题 | 链接（框内嵌上传按钮）| 删除，下面紧跟**本行自己的**歌词 / 字幕。
 *
 * 地址与文件是**同一个字段**：可以手粘链接，也可以点框里的上传按钮，上传完把站内地址回填进来 ——
 * 不再有「上传模式」这种需要作者先声明一次的选项（两种来源落库结果本来就是同一个 URL）。
 * 拖放上传保留：把文件拖到整行上即可。
 *
 * 字幕跟行走的取舍见 lib/meta.ts 的 avTrackSchema：切曲目即切歌词，没有「多轨切换」的概念。
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Loader, Trash2, UploadCloud } from "lucide-react";
import { avAcceptAttr, avExtsSample, avMountPlaceholder, type AvKind } from "@/lib/av";
import type { CaptionDraft } from "@/lib/captions";
import { formatBytes } from "@/lib/format";
import { useFileDrop } from "@/lib/hooks/use-file-drop";
import { uploadAttachment } from "@/lib/upload-attachment-client";
import { Button } from "@/components/ui/Button";
import { CaptionField } from "./caption-section";
import { fieldErr, wizInput } from "./wizard-shared";

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

export function AvRowEditor({
  row,
  label,
  avKind,
  unit,
  limits,
  /** 主来源行（第一行）：地址 / 标题进 form 具名字段，且上传后由宿主抓取时长 / 分辨率 / 抽帧 */
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
  onUploaded?: (file: File, url: string) => void;
  onBusy?: (id: string, busy: boolean) => void;
}) {
  const isAudio = avKind === "audio";
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // 上传中不允许再拖入（与文件选择器的 disabled 语义对齐）
  const { dragging, dropProps } = useFileDrop({ onFiles: (f) => void onFile(f[0] ?? null), disabled: uploading });

  // 在飞上传同步给宿主，供提交按钮禁用（与 AttachmentListEditor 同契约）
  useEffect(() => {
    onBusy?.(row.id, uploading);
  }, [uploading, onBusy, row.id]);

  async function onFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setPercent(0);
    setMsg(null);
    try {
      const done = await uploadAttachment(file, setPercent, isAudio ? "music" : "video");
      onPatch({ url: done.url });
      setMsg(`已上传 ${done.name}（${formatBytes(done.size)}）`);
      // 元数据抓取 / 抽帧交给宿主：它们只对主来源有意义（时长、艺术家、分辨率都是资源级字段）
      onUploaded?.(file, done.url);
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

  return (
    <li
      {...dropProps}
      className={`rounded-none border p-3 ${
        dragging ? "border-brand-500 bg-brand-50" : "border-brand-200 bg-surface"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums text-neutral-500">{label}</span>
        {isMain && <span className="text-[11px] text-neutral-400">主来源</span>}
        <span className="flex-1" />
        <Button
          type="button"
          onClick={onRemove}
          /* 只剩一行时宿主只清空不删除（列表总得留一行给作者填地址），文案跟着变 */
          aria-label={canRemove ? `删除${label}` : `清空${label}`}
          className="rounded-none border border-brand-200 p-2 text-neutral-500 hover:border-red-300 hover:text-red-600"
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {/* 标题 | 链接（内嵌上传按钮）—— 一行一个 */}
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <input
          value={row.title}
          name={titleName}
          onChange={(e) => onPatch({ title: e.target.value })}
          maxLength={120}
          placeholder={`${unit}标题（可留空）`}
          aria-label={`${label}的标题`}
          className={wizInput}
        />
        <div className="flex min-w-0 items-stretch">
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
            className={`${wizInput} min-w-0 flex-1`}
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label={uploadHint}
            title={uploadHint}
            /* 紧贴输入框右侧的图标按钮：与输入框共用一条边框（-ml-px），所以不走 wizBtn ——
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
      </div>

      {uploading && (
        <div
          className="mt-2 h-1 w-full bg-brand-100"
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

      {/* 本行自己的歌词 / 字幕 */}
      <div className="mt-2">
        <CaptionField
          avKind={avKind}
          value={row.caption}
          onChange={(c) => onPatch({ caption: c })}
          fieldErrors={fieldErrors}
          errorKey={captionErrorKey}
        />
      </div>

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
