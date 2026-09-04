"use client";

import { X } from "lucide-react";
import { SectionTitle, type Uploaded } from "./wizard-shared";

/** 预览图/插图选择网格：上传、点选封面、移除（最多 12 张） */
export default function MediaPicker({
  files,
  coverId,
  uploading,
  isArticle,
  uploadMsg,
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
  uploadMsg: string | null;
  fieldError?: string[];
  onPick: (fl: FileList | null) => void;
  onRemove: (id: string) => void;
  onSetCover: (id: string) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <section className="mt-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle
        n={isArticle ? 2 : 3}
        tail={<span className="font-normal tabular-nums text-neutral-400">{files.filter((f) => f.ok).length}/12</span>}
      >
        {isArticle ? "插图" : "预览图"}
        {!isArticle && <span className="text-red-500">*</span>}
      </SectionTitle>
      <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
        {files.map((f) => (
          <div key={f.id} className="group relative overflow-hidden rounded-none border border-brand-200 bg-neutral-100">
            {f.ok && f.bigUrl ? (
              <button
                type="button"
                onClick={() => onSetCover(f.id)}
                title="设为封面"
                className="block w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.bigUrl} alt={f.name} className="aspect-square w-full object-cover" />
              </button>
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
            <button
              type="button"
              onClick={() => onRemove(f.id)}
              aria-label="移除"
              className="absolute right-1.5 top-1.5 rounded-none bg-black/55 p-1 text-white opacity-0 transition group-hover:opacity-100"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <label className="grid aspect-square w-full cursor-pointer place-items-center rounded-none border-2 border-dashed border-brand-300 bg-brand-50/40 text-center text-brand-700 transition hover:border-brand-500 hover:bg-brand-50">
          <span className="px-2 text-xs">
            {uploading ? "处理中…" : files.length >= 12 ? "已达上限" : "＋ 上传图片"}
            <span className="mt-0.5 block font-normal text-[10px] opacity-70">png/jpg/webp ≤20MB</span>
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            disabled={uploading || files.length >= 12}
            onChange={(e) => onPick(e.target.files)}
            className="hidden"
          />
        </label>
      </div>
      {fieldError && fieldError.length > 0 && <p className="mt-1 text-xs text-red-500">{fieldError[0]}</p>}
      {uploadMsg && <p className="mt-2 text-xs text-amber-600">{uploadMsg}</p>}
    </section>
  );
}
