"use client";

import { X } from "lucide-react";
import { SectionTitle, STEP, type Uploaded } from "./wizard-shared";
import { Button } from "@/components/ui/Button";
import { useFileDrop } from "@/lib/hooks/use-file-drop";
import { useFilePaste } from "@/lib/hooks/use-file-paste";
import type { UploadProgress } from "@/lib/upload-image-client";

/** 预览图/插图选择：上传、设封面、移除（最多 maxCount 张，默认 12）；单张上限由宿主配置传入 */
export default function MediaPicker({
  files,
  coverId,
  uploading,
  isArticle,
  singleCover,
  maxMb,
  maxCount = 12,
  uploadMsg,
  progress,
  fieldError,
  onPick,
  onRemove,
  onSetCover,
  fileRef,
}: {
  files: Uploaded[];
  coverId: string;
  uploading: boolean;
  isArticle: boolean;
  /** 只允许一张封面的类型（文章 / 音乐 / 视频）：标题与必填标记不同 */
  singleCover?: boolean;
  maxMb: number;
  maxCount?: number;
  uploadMsg: string | null;
  /** 批量上传进度：多张时显示「第 n / 共 m」与整体进度条 */
  progress?: UploadProgress | null;
  fieldError?: string[];
  onPick: (fl: FileList | null) => void;
  onRemove: (id: string) => void;
  onSetCover: (id: string) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  const okCount = files.filter((f) => f.ok).length;
  const oneShot = singleCover ?? isArticle;
  const full = files.length >= maxCount;
  // 整块缩略图网格都是投放区：不必对准虚线格，拖到已有缩略图上同样算数。
  // 掉落的文件直接交给 onPick —— 与 <input type="file"> 是同一条上传链路，调用方无需感知拖拽。
  const { dragging, dropProps } = useFileDrop({
    onFiles: onPick,
    disabled: uploading || full,
  });
  // Ctrl+V：在这块区域内粘贴截图/复制的图片即上传，同样直送 onPick。
  // 单张封面且已有图时关掉——再粘一张只会被 onFiles 静默丢弃，不如不接管。
  const { pasteProps } = useFilePaste({
    onFiles: onPick,
    disabled: uploading || full,
    enabled: !(oneShot && files.length > 0),
  });
  return (
    <section className="mt-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle
        n={STEP.MEDIA}
        tail={
          <span className="font-normal tabular-nums text-neutral-400">
            {okCount}/{maxCount}
          </span>
        }
      >
        {oneShot ? "封面" : "预览图"}
        {!oneShot && <span className="text-red-500">*</span>}
      </SectionTitle>
      <div
        {...dropProps}
        {...pasteProps}
        tabIndex={-1}
        className={`mt-3 grid grid-cols-3 gap-3 outline-none transition-colors sm:grid-cols-4 ${
          dragging ? "bg-brand-50 ring-2 ring-brand-400" : ""
        }`}
      >
        {files.map((f) => (
          <div
            key={f.id}
            className="group relative overflow-hidden rounded-none border border-brand-200 bg-neutral-100"
          >
            {f.ok && f.bigUrl ? (
              <Button
                type="button"
                onClick={() => onSetCover(f.id)}
                title="设为封面"
                className="block w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.bigUrl} alt={f.name} className="aspect-square w-full object-cover" />
              </Button>
            ) : (
              <div className="grid aspect-square w-full place-items-center p-2 text-center text-[11px] text-red-500">
                {f.error ?? "失败"}
              </div>
            )}
            {f.ok && coverId === f.id && (
              <span className="absolute left-1.5 top-1.5 rounded-none border border-brand-600 bg-brand-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                封面
              </span>
            )}
            <Button
              type="button"
              onClick={() => onRemove(f.id)}
              aria-label="移除"
              className="absolute right-1.5 top-1.5 rounded-none bg-black/55 p-1 text-white opacity-0 transition group-hover:opacity-100"
            >
              <X size={12} />
            </Button>
          </div>
        ))}
        <label
          className={`grid aspect-square w-full cursor-pointer place-items-center rounded-none border-2 border-dashed text-center transition ${
            dragging
              ? "border-brand-600 bg-brand-100 text-brand-700"
              : "border-brand-300 bg-brand-50/40 text-brand-700 hover:border-brand-500 hover:bg-brand-50"
          }`}
        >
          <span className="px-2 text-xs">
            {dragging
              ? "松开即可上传"
              : uploading
                ? progress && progress.total > 1
                  ? `上传中 ${Math.min(progress.done + 1, progress.total)}/${progress.total}`
                  : "处理中…"
                : full
                  ? "已达上限"
                  : "＋ 上传图片"}
            <span className="mt-0.5 block font-normal text-[10px] opacity-70">
              拖入/点击/粘贴 · png/jpg/webp ≤{maxMb}MB
            </span>
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple={maxCount > 1}
            disabled={uploading || full}
            onChange={(e) => onPick(e.target.files)}
            className="hidden"
          />
        </label>
      </div>
      {fieldError && fieldError.length > 0 && (
        <p className="mt-1 text-xs text-red-500">{fieldError[0]}</p>
      )}
      {uploading && progress && progress.total > 0 && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <span className="truncate">
              正在上传 {Math.min(progress.done + 1, progress.total)}/{progress.total}
              {progress.name ? ` · ${progress.name}` : ""}
            </span>
            <span className="tabular-nums text-neutral-400">
              {Math.round((progress.done / progress.total) * 100)}%
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-none bg-brand-100">
            <div
              className="h-full bg-brand-500 transition-[width] duration-300"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {uploadMsg && <p className="mt-2 text-xs text-amber-600">{uploadMsg}</p>}
    </section>
  );
}
