"use client";

/**
 * 单个播放项的**设置抽屉** —— 曲目 / 分P 列表行上只剩「标题 + 行尾设置图标」，
 * 改标题、改地址、上传文件、挂字幕 / 歌词全收在这里（入口见 av-row.tsx）。
 *
 * 为什么整体收进抽屉：一个播放项真正需要常驻的信息只有「它是第几项、叫什么」，
 * 地址框、上传按钮、字幕编辑器（自带格式下拉 / 摘要 / 两个动作 / 可展开的粘贴区）
 * 摊在列表里会让每行长高三四倍，而绝大多数曲目 / 分P 连地址都只用填一次、
 * 字幕更是常年空着。抽屉**只在打开时挂载**，那些行就只剩一行的高度。
 *
 * 值全部**受控**：宿主（av-row → av-section）持标题 / 地址 / 字幕，
 * 这里一个隐藏字段都不渲染 —— 主来源的 avUrl / avTitle、全部行的字幕都随
 * av-section 那一组隐藏字段提交（见那边的「受控序列化」注释）。
 * 也因此这里能随便增删行：抽屉自己持 state 会在删中间一行时把内容错位到别的项上。
 *
 * 上传：地址与文件是**同一个字段**（手粘链接 / 上传文件回填，落库结果都是 URL），
 * 所以这里不给「上传模式」这种要先声明一次的选项。文件选择器由宿主持有（`onPickFile`），
 * 行上的整行拖拽与这里的上传按钮共用同一条上传链路与同一个进度。
 */

import { useEffect, useRef } from "react";
import { Loader, UploadCloud, X } from "lucide-react";
import { AV_TITLE_MAX, avExtsSample, avMountPlaceholder, type AvKind } from "@/lib/av";
import type { CaptionDraft } from "@/lib/captions";
import { Button } from "@/components/ui/Button";
import { CaptionField } from "./caption-field";
import { fieldErr, wizLabel } from "./wizard-shared";

/** 抽屉里可改的字段（与宿主 AvPlayRow 的子集同型，故意不 import 那边 —— 免得两个组件互相引用） */
export type AvItemPatch = { title?: string; url?: string; caption?: CaptionDraft | null };

/** 抽屉内的输入盒：比行内那档更松（这里的宽度不值钱，触控目标该够大） */
const boxBase =
  "rounded-none border border-brand-200 bg-surface outline-none transition placeholder:text-neutral-400 focus:border-brand-500";

export type AvItemDrawerProps = {
  open: boolean;
  /** 关闭回调。**必须是稳定引用**（宿主用 useCallback），否则本组件里的 effect 每次重渲染都重跑、反复抢焦点 */
  onClose: () => void;
  /** 展示名，如「P1」/「曲目 2」 */
  label: string;
  /** 分P 的统称（音频=曲目，视频=分P） */
  unit: string;
  avKind: AvKind;
  isMain: boolean;
  /** 列表里不止这一行（决定底部的按钮是「删除」还是「清空」，见宿主 remove） */
  canRemove: boolean;
  limits: { attachmentMaxMb: number };
  title: string;
  url: string;
  caption: CaptionDraft | null;
  uploading: boolean;
  percent: number | null;
  /** 上传结果 / 失败提示（行上那份只在抽屉关着时显示，不重复叨扰） */
  msg: string | null;
  onPatch: (patch: AvItemPatch) => void;
  onRemove: () => void;
  /** 打开宿主持有的文件选择器（行上的拖拽与这里共用一条上传链路） */
  onPickFile: () => void;
  fieldErrors?: Record<string, string[]>;
  /** 本项字幕在扁平化错误对象里的键：主来源 `caption`，其余 `tracks.{i}.caption` */
  errorKey: string;
};

/** 关着时整个不渲染：内部 state（粘贴草稿、提示）随之丢弃，下次打开是干净的 */
export function AvItemDrawer(props: AvItemDrawerProps) {
  if (!props.open) return null;
  return <DrawerBody {...props} />;
}

function DrawerBody({
  onClose,
  label,
  unit,
  avKind,
  isMain,
  canRemove,
  limits,
  title,
  url,
  caption,
  uploading,
  percent,
  msg,
  onPatch,
  onRemove,
  onPickFile,
  fieldErrors,
  errorKey,
}: AvItemDrawerProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const isAudio = avKind === "audio";

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

  /** 上传按钮不必展示 accept 串，但把上限写进 title，作者点之前就能判断该不该压缩 */
  const uploadHint = `上传${isAudio ? "音频" : "视频"}文件（单文件 ≤ ${limits.attachmentMaxMb} MB，支持 ${avExtsSample(avKind, 4)}）`;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/40" onClick={onClose} aria-hidden />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${label} 设置`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col rounded-none border-l border-brand-200 bg-panel shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-brand-200 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-900">
              {label}
              <span className="ml-1.5 font-normal text-neutral-400">
                {isMain ? `主来源 · ${unit}` : unit}
              </span>
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-neutral-400">
              标题、地址与{isAudio ? "歌词" : "字幕"}都在这里改
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
          <label className="block">
            <span className={wizLabel}>标题</span>
            <input
              value={title}
              onChange={(e) => onPatch({ title: e.target.value })}
              maxLength={AV_TITLE_MAX}
              placeholder={`${unit}标题（可留空）`}
              aria-label={`${label}的标题`}
              className={`${boxBase} mt-1.5 w-full px-2.5 py-2 text-sm`}
            />
            <span className="mt-1.5 block text-[11px] leading-4 text-neutral-400">
              留空则按上传的文件名自动填，也可以自己改
            </span>
          </label>

          <div>
            <span className={wizLabel}>地址</span>
            <div className="mt-1.5 flex min-w-0 items-stretch">
              <input
                value={url}
                onChange={(e) => onPatch({ url: e.target.value })}
                maxLength={2000}
                placeholder={avMountPlaceholder(avKind)}
                aria-label={`${label}的地址`}
                className={`${boxBase} min-w-0 flex-1 px-2.5 py-2 text-sm`}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                onClick={onPickFile}
                disabled={uploading}
                aria-label={uploadHint}
                title={uploadHint}
                /* 紧贴输入框右侧的图标按钮：与输入框共用一条边框（-ml-px），所以不走 Button 的尺寸轴 ——
                   它的 px-3 会和这里的 px-2.5 撞在同一组属性上，谁生效取决于产物顺序。 */
                className="-ml-px inline-flex shrink-0 items-center justify-center rounded-none border border-brand-200 bg-surface px-2.5 text-neutral-500 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-60"
              >
                {uploading ? (
                  <Loader size={15} className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <UploadCloud size={15} aria-hidden />
                )}
              </Button>
            </div>
            <span className="mt-1.5 block text-[11px] leading-4 text-neutral-400">
              可粘链接、点右侧按钮选文件，或把文件直接拖到列表里那一行上。
              {isMain ? "主来源必填" : "留空的行保存时会被跳过"}
            </span>
            {fieldErr(fieldErrors?.title)}
            {isMain && fieldErr(fieldErrors?.url)}
          </div>

          {uploading && (
            <div
              className="h-1 w-full bg-brand-100"
              role="progressbar"
              aria-label="上传进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? 0}
            >
              <div
                className="h-full bg-brand-500 transition-[width]"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
          )}
          {msg && <p className="text-xs leading-5 text-amber-600">{msg}</p>}

          {/* 字幕与地址之间划一条线：前者是附加内容，后者是这一项能不能站得住的前提 */}
          <div className="border-t border-brand-100 pt-4">
            <CaptionField
              avKind={avKind}
              value={caption}
              onChange={(c) => onPatch({ caption: c })}
              fieldErrors={fieldErrors}
              errorKey={errorKey}
            />
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-brand-200 p-4">
          <Button type="button" variant="dangerGhost" size="xs" onClick={onRemove}>
            {canRemove ? `删除${label}` : `清空${label}`}
          </Button>
          <Button type="button" variant="primary" size="md" className="ml-auto" onClick={onClose}>
            完成
          </Button>
        </footer>
      </aside>
    </>
  );
}
