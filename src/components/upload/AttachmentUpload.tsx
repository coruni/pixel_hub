"use client";

import { UploadCloud } from "lucide-react";
import {
  attachmentAcceptAttr,
  mbText,
  type UploadLimits,
} from "@/lib/upload-config";

/** 附件上传区域只关心附件体积 + 后缀两个字段 */
export type AttachLimits = Pick<UploadLimits, "attachmentMaxMb" | "attachmentExts">;

/** 上传按钮的统一外观（全站附件上传入口共用，改这一处即全站生效） */
const BTN =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 transition hover:border-brand-500 hover:text-neutral-900";
/** 拖拽经过时的外观 */
const BTN_DRAG = "border-brand-500 bg-brand-50 text-neutral-900";
/** 禁用 / 上传中的外观 */
const BTN_BUSY = "cursor-not-allowed opacity-60";

/**
 * 全站统一的「附件上传区域」。
 *
 * 三种用法（同一套状态与文案，长相按场景切换）：
 * - `variant="button"`（默认）：行内按钮，适合表单里紧跟某个字段的场景。
 * - `variant="dropzone"`：整块虚线投放区，适合清单/列表场景——拖进来或点一下都能上传，
 *   有明确的可投放边界，比按钮更符合「拖拽上传」的心智。
 *
 * 状态收在这一处：可上传、拖拽悬停、上传中、配额与格式提示、已上传回执。
 *
 * - `multiple` 决定是否允许一次多选（清单类多选，单封面/版本表单单选）。
 * - 选择后必须清空 input.value：否则同一批文件第二次选择不触发 change。
 * - `dropProps` 来自 useFileDrop；调用方把它展开到投放容器上，高亮由 `dragging` 驱动。
 */
export function AttachmentUpload({
  onFiles,
  limits,
  accept,
  multiple = false,
  uploading = false,
  progress,
  percent,
  hint,
  filled = false,
  dragging = false,
  dropProps,
  label = "上传文件",
  variant = "button",
}: {
  /** 选中的文件；与 <input type="file"> 的 FileList 同型，两条入口共用一条上传链路 */
  onFiles: (files: FileList) => void;
  limits: AttachLimits;
  /**
   * 覆盖文件选择器的 accept，默认按附件后缀表（`limits.attachmentExts`）。
   * 音乐 / 视频必须传 `avAcceptAttr(kind)`——它们的白名单是 `avExtsFor(kind)` 那套
   * （含 m4a/aac/opus/m4v/mov 等附件表里没有的后缀），沿用附件表会把合法音视频挡在选择器外。
   */
  accept?: string;
  /** 一次可选多个（清单类），默认单选 */
  multiple?: boolean;
  uploading?: boolean;
  /** 批量上传进度：多文件时才显示「第 n / 共 m」 */
  progress?: { done: number; total: number } | null;
  /**
   * 当前文件的字节进度（0..100）。多文件串行时它指的是「正在传的那一个」。
   * 0 与 undefined 都当作「还没有可展示的进度」——避免刚起步就闪一条 0% 空条。
   */
  percent?: number | null;
  /** 追加在「支持 xxx，单文件 y MB」之后的补充说明（如「可多选」） */
  hint?: string;
  /** 已回填站内路径的回执 */
  filled?: boolean;
  dragging?: boolean;
  dropProps?: React.HTMLAttributes<HTMLElement>;
  /** 未上传时的按钮文案，默认「上传文件」 */
  label?: string;
  variant?: "button" | "dropzone";
}) {
  const busy = uploading;
  const multiText = progress && progress.total > 1 ? ` ${progress.done}/${progress.total}` : "";
  const text = busy ? `上传中${multiText}…` : label;
  const acceptAttr = accept ?? attachmentAcceptAttr(limits.attachmentExts);
  /** 有意义的字节进度：0 不显示（刚起步，条形还没内容，显示反而像卡住） */
  const shownPercent =
    typeof percent === "number" && percent > 0 ? Math.min(100, Math.round(percent)) : null;

  // 两条入口共用同一个隐藏 input（点击 label 与拖放都走它），避免逻辑分叉
  const input = (
    <input
      type="file"
      hidden
      multiple={multiple}
      disabled={busy}
      accept={acceptAttr}
      onChange={(e) => {
        const fl = e.target.files;
        // 清空必须排在 onFiles 之后：input.files 返回的是挂在元素上的同一份 FileList，
        // 先清空会把已捕获的引用一起清掉，消费方拿到空列表 → 「点了没反应」。
        if (fl && fl.length > 0) onFiles(fl);
        e.target.value = "";
      }}
    />
  );

  const meta = (
    <span className={variant === "dropzone" ? "mt-1 block text-[11px] font-normal opacity-75" : "text-xs text-neutral-400"}>
      单文件 {mbText(limits.attachmentMaxMb)}
      {hint ? `，${hint}` : ""}
    </span>
  );

  /** 单文件字节进度：细条 + 百分比数字，数字是给屏幕阅读器和看不清条的人兜底的 */
  const bar = shownPercent != null && (
    <span
      className={`${variant === "dropzone" ? "mt-1.5" : "ml-0.5"} block w-full`}
      role="progressbar"
      aria-label="当前文件上传进度"
      aria-valuenow={shownPercent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        className={`block h-1 w-full overflow-hidden rounded-none ${
          variant === "dropzone" ? "bg-brand-100" : "bg-neutral-100"
        }`}
      >
        <span
          className="block h-full rounded-none bg-brand-500 transition-[width] duration-200"
          style={{ width: `${shownPercent}%` }}
        />
      </span>
      <span className={variant === "dropzone" ? "mt-0.5 block text-[11px] opacity-75" : "mt-0.5 block text-xs text-neutral-400"}>
        {shownPercent}%
      </span>
    </span>
  );

  if (variant === "dropzone") {
    return (
      <div {...dropProps} className="w-full">
        <label
          className={`flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-none border-2 border-dashed px-4 py-6 text-center text-xs transition ${
            busy
              ? "cursor-not-allowed border-brand-200 bg-neutral-50 text-neutral-400"
              : dragging
                ? "border-brand-600 bg-brand-100 text-brand-700"
                : "border-brand-300 bg-brand-50/40 text-brand-700 hover:border-brand-500 hover:bg-brand-50"
          }`}
        >
          <UploadCloud size={20} aria-hidden />
          <span>{text}</span>
          {bar}
          {meta}
          {input}
        </label>
        {filled && <span className="mt-1.5 block text-xs text-emerald-600">✓ 已上传站内附件</span>}
      </div>
    );
  }

  return (
    <div {...dropProps} className="flex min-w-0 flex-wrap items-center gap-2">
      <label className={`${BTN} ${busy ? BTN_BUSY : ""} ${dragging && !busy ? BTN_DRAG : ""}`}>
        <UploadCloud size={14} aria-hidden />
        {text}
        {input}
      </label>
      {/* 进度条占满剩余宽度：按钮是行内的，整条只有贴着它才读得出「这是这个文件在传」 */}
      {shownPercent != null ? <span className="min-w-24 flex-1">{bar}</span> : null}
      {filled && <span className="text-xs text-emerald-600">✓ 已上传站内附件</span>}
      {meta}
    </div>
  );
}
