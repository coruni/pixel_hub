"use client";

/**
 * 单个「播放项」编辑行 —— 曲目 / 分P 一行一个（由 av-section 渲染列表，发布向导与后台改稿共用）。
 *
 * 一行只有**一个标题 + 行尾一个设置图标**：改标题、改地址、上传文件、挂字幕 / 歌词
 * 全在那颗图标打开的抽屉里（见 av-item-drawer.tsx）。常驻信息只留「第几项、叫什么」，
 * 其余都是「打开才需要看一眼」的东西 —— 列表 12 行时这决定了它是一屏还是一页。
 *
 * 但**整行仍是拖放区**（把文件拖到这一行上即可上传，上传期间行内显示百分比进度条）：
 * 拖拽不需要占用任何可见面积，是这条列表上最快的录入方式，没必要一起锁进抽屉。
 *
 * 标题从上传的文件名取（见 lib/av.ts 的 avTitleFromFile）：只在作者还没自己填、或填的正是上一次
 * 自动值时才写入 —— 手改过的标题绝不被后一次上传覆盖。
 *
 * 表单字段一个都不在这里：主来源的 avUrl / avTitle 与全部字幕都由 av-section 的隐藏字段序列化提交，
 * 而抽屉关着时压根不渲染 —— 字段若挂在这边，抽屉一关就丢值了。
 *
 * 字幕跟行走的取舍见 lib/meta.ts 的 avTrackSchema：切曲目即切歌词，没有「多轨切换」的概念。
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Settings2 } from "lucide-react";
import { avAcceptAttr, avTitleFromFile, type AvKind } from "@/lib/av";
import type { CaptionDraft } from "@/lib/captions";
import { formatBytes } from "@/lib/format";
import { useFileDrop } from "@/lib/hooks/use-file-drop";
import { uploadAttachment } from "@/lib/upload-attachment-client";
import { Button } from "@/components/ui/Button";
import { AvItemDrawer } from "./av-item-drawer";

/** 编辑器里的播放项。`id` 是行身份：行会增删，用下标当 key 会让抽屉 / 上传进度错位到别的曲目 */
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

/** 行尾图标按钮：与行内文字同高，不是 44px 触控目标，但要够得着 */
const rowIconBtn =
  "relative shrink-0 rounded-none border p-1.5 transition focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-60";

export function AvRowEditor({
  row,
  label,
  avKind,
  unit,
  limits,
  /** 主来源行（第一行）：它的地址 / 标题进 av-section 的具名字段，且上传后由宿主抽帧当封面 */
  isMain = false,
  /** 列表里不止这一行（决定抽屉底部的按钮是「删除」还是「清空」，见宿主 remove） */
  canRemove = true,
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
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const openBtnRef = useRef<HTMLButtonElement | null>(null);
  // 上传中不允许再拖入（与文件选择器的 disabled 语义对齐）；**抽屉开着时也要关掉**——
  // 抽屉是 fixed 定位但仍挂在 <li> 的 DOM 子树里，往抽屉里拖字幕文件时 drop 会冒泡上来，
  // 不关的话同一个 .srt 既会被读成字幕、又会被当成视频上传。
  const { dragging, dropProps } = useFileDrop({
    onFiles: (f) => void onFile(f[0] ?? null),
    disabled: uploading || open,
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
  const closeDrawer = useCallback(() => {
    setOpen(false);
    openBtnRef.current?.focus();
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

  const word = isAudio ? "歌词" : "字幕";
  const hasCaption = !!row.caption?.text.trim();
  const hasUrl = !!row.url.trim();
  // 这一行的错误：主来源有自己的 url / title 字段，其余行只会拿到字幕那一份
  const errs = isMain
    ? [
        ...(fieldErrors?.title ?? []),
        ...(fieldErrors?.url ?? []),
        ...(fieldErrors?.[captionErrorKey] ?? []),
      ]
    : (fieldErrors?.[captionErrorKey] ?? []);
  // 有内容却没地址的行在提交时会被静默丢掉（av-section 的序列化只送有地址的行）——
  // 提前说一句，别让作者保存完才发现少了一项。
  const orphan = !hasUrl && (!!row.title.trim() || hasCaption);

  return (
    <li
      {...dropProps}
      className={`border p-2 ${
        dragging ? "border-brand-500 bg-brand-50" : "border-brand-200 bg-surface"
      }`}
    >
      {/* 整行就这一层：编号 · 标题 · 设置入口。其余都在抽屉里 */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs tabular-nums text-neutral-500">{label}</span>
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            row.title.trim() ? "" : "text-neutral-400"
          }`}
        >
          {row.title.trim() || `未命名${unit}`}
        </span>
        {isMain && <span className="shrink-0 text-[11px] text-neutral-400">主来源</span>}
        <Button
          ref={openBtnRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          /* 名称里带上缺什么：地址没填的行保存时会被跳过，这是这颗按钮唯一需要自解释的状态 */
          aria-label={
            hasUrl
              ? `${label} 设置${hasCaption ? `（已挂${word}）` : ""}`
              : `${label} 设置（尚未填地址）`
          }
          title={hasUrl ? (hasCaption ? `设置：已挂${word}` : "设置") : "设置：尚未填地址"}
          className={`${rowIconBtn} ${
            hasUrl
              ? "border-brand-200 bg-surface text-neutral-500 hover:border-brand-400 hover:text-brand-700"
              : "border-amber-300 bg-surface text-amber-600 hover:border-amber-500 hover:text-amber-700"
          }`}
        >
          <Settings2 size={15} aria-hidden />
          {/* 已挂字幕：除颜色外加一个角标，状态不靠颜色单独表达 */}
          {hasCaption && (
            <span
              className="absolute -right-0.5 -top-0.5 block h-1.5 w-1.5 bg-brand-500"
              aria-hidden
            />
          )}
        </Button>
      </div>

      {/* 上传进度与结果：抽屉开着时由抽屉显示（那边才是刚操作的地方），这里只管抽屉关着的那份 */}
      {!open && uploading && (
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
      {!open && msg && <p className="mt-1.5 text-xs text-amber-600">{msg}</p>}

      {/* 错误始终摊在行上：抽屉关着时若把错误藏在里面，作者提交失败后根本找不到是哪一行 */}
      {errs.length > 0 ? (
        <p className="mt-1.5 text-xs text-red-500">{errs[0]}</p>
      ) : (
        orphan && (
          <p className="mt-1.5 text-xs text-amber-600">
            这一项还没有地址，保存时会被跳过（点右侧设置填写）
          </p>
        )
      )}

      <AvItemDrawer
        open={open}
        onClose={closeDrawer}
        label={label}
        unit={unit}
        avKind={avKind}
        isMain={isMain}
        canRemove={canRemove}
        limits={limits}
        title={row.title}
        url={row.url}
        caption={row.caption}
        uploading={uploading}
        percent={percent}
        msg={msg}
        onPatch={onPatch}
        onRemove={onRemove}
        onPickFile={() => fileRef.current?.click()}
        onDropFile={(f) => void onFile(f)}
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
