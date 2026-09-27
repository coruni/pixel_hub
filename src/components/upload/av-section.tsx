"use client";

// 音乐 / 视频分节 —— 发布向导与后台改稿共用。
//
// 表单形状就是一个「播放项」列表，与 lib/av-tracks.ts 的 avPlaylist 完全同构：
//   第 1 行 = 主来源（落 meta.title / meta.url / meta.caption）
//   其余行 = 分P / 曲目（落 meta.tracks[]，每行含自己的标题、地址与字幕）
// 每行都是「标题 | 链接（框内嵌上传按钮）| 删除」，歌词 / 字幕挂在行下面 —— 一项一份。
//
// 没有「上传模式」选择：地址框里既能手填链接，也能点旁边的按钮上传文件（上传完回填站内地址）。
// 站内路径与 http(s) 外链由 URL 形态自解释，不需要作者再声明一次。
//
// 播放形态也不再手选：音频**恒站内播放**（不再提供 iframe 形态）；视频保留嵌入页，
// 形态由地址自动判定（站内路径 / 已知媒体后缀 → 站内播放器，其余 http(s) 页面 → iframe）。
//
// 没有「时长 / 艺术家 / 分辨率」这类补充字段：它们是自动从一个文件里读出来的资源级元信息，
// 作者既不需要手填、也不该为「自动读到什么」负责，详情页同样不再展示。上传视频时仍会抽一帧
// 当封面（见 lib/av-probe.ts），那是唯一保留的自动动作。

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { avClassFor, avExtsSample, suggestMode, type AvKind } from "@/lib/av";
import { serializeAvTracks } from "@/lib/av-tracks";
import { serializeCaptionDraft, type CaptionDraft } from "@/lib/captions";
import { AV_TRACKS_MAX } from "@/lib/meta";
import { capturePoster } from "@/lib/av-probe";
import { mbText, type UploadLimits } from "@/lib/upload-config";
import { fieldErr, wizLabel, SectionTitle, STEP } from "./wizard-shared";
import { AvRowEditor, newRowId, type AvPlayRow } from "./av-row";
import { Button } from "@/components/ui/Button";

export type AvSectionInitial = {
  /** 主来源（第一 P）的展示名 */
  title?: string;
  url?: string;
  /** 主来源自己的字幕 / 歌词 */
  caption?: CaptionDraft;
  /** 分P / 曲目（**不含主来源**那一 P）；caption 为 null 表示这一项没挂字幕 */
  tracks?: { title: string; url: string; caption?: CaptionDraft | null }[];
};

/** 初始行：第 1 行恒存在（作者总得有个地方填地址），其余按存量数据铺开 */
function initRows(initial?: AvSectionInitial): AvPlayRow[] {
  const rows: AvPlayRow[] = [
    { id: "r0", title: initial?.title ?? "", url: initial?.url ?? "", caption: initial?.caption ?? null },
  ];
  (initial?.tracks ?? []).forEach((t, i) =>
    rows.push({ id: `r${i + 1}`, title: t.title ?? "", url: t.url ?? "", caption: t.caption ?? null }),
  );
  return rows;
}

export function AvSection({
  avKind,
  initial,
  fieldErrors,
  limits,
  onBusyChange,
  onCoverFrame,
}: {
  avKind: AvKind;
  /** audio=音乐 / video=视频 */
  initial?: AvSectionInitial;
  fieldErrors?: Record<string, string[]>;
  limits: UploadLimits;
  /** 在飞上传数（0/1/…）：宿主据此禁用提交，避免「文件还在传就点了发布」 */
  onBusyChange?: (busy: number) => void;
  /**
   * 视频抽帧得到的封面（JPEG File）。宿主负责上传并落到「封面」槽位。
   * 只有 video 会调用——音频没有画面可抽。
   */
  onCoverFrame?: (file: File) => void;
}) {
  const [rows, setRows] = useState<AvPlayRow[]>(() => initRows(initial));
  /** 正在上传的行 id（可能多行同时传，所以是集合而不是布尔） */
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const isAudio = avKind === "audio";
  const label = avClassFor(avKind);
  const unit = isAudio ? "曲目" : "分P";

  const patch = useCallback((id: string, next: Partial<AvPlayRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)));
  }, []);

  /** 删行：最后一行不真删，只清空 —— 列表至少留一行给作者填地址 */
  const remove = useCallback((id: string) => {
    setMsg(null);
    setRows((prev) => {
      if (prev.length <= 1) return prev.map((r) => (r.id === id ? { id: r.id, title: "", url: "", caption: null } : r));
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  function add() {
    if (rows.length >= AV_TRACKS_MAX) {
      setMsg(`${unit}最多 ${AV_TRACKS_MAX} 行`);
      return;
    }
    setMsg(null);
    setRows((prev) => [...prev, { id: newRowId(), title: "", url: "", caption: null }]);
  }

  /** 在飞上传数同步给宿主，供提交按钮禁用（与 AttachmentListEditor 同契约） */
  useEffect(() => {
    onBusyChange?.(busyIds.length);
  }, [busyIds, onBusyChange]);

  const setRowBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const has = prev.includes(id);
      if (busy === has) return prev; // 值没变就不造新数组，避免无谓重渲染
      return busy ? [...prev, id] : prev.filter((x) => x !== id);
    });
  }, []);

  // 抽帧是异步的，回调身份每渲染都在变——用 ref 取最新值，别让闭包拿着旧函数
  const coverFrameRef = useRef(onCoverFrame);
  useEffect(() => {
    coverFrameRef.current = onCoverFrame;
  });

  const mainUrl = rows[0]?.url ?? "";
  /** 主来源的形态（站内 / 直链 / 嵌入页）；视频才有 embed 的可能 */
  const mode = isAudio ? "direct" : suggestMode(mainUrl, "video");

  /**
   * 主来源上传完成：抽一帧当封面（宿主负责上传并落封面槽）。
   * 只有视频有画面可抽，音频直接跳过。
   */
  async function onMainUploaded(file: File) {
    if (isAudio || !coverFrameRef.current) return;
    const poster = await capturePoster(file);
    if (poster) coverFrameRef.current(poster);
  }

  const [main, ...rest] = rows;

  return (
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle
        n={STEP.TYPE}
        tail={<span className="font-normal text-neutral-400">{label}来源</span>}
      >
        {isAudio ? "音频" : "视频"}信息
      </SectionTitle>

      <div>
        <span className={wizLabel}>{unit}列表</span>
        <p className="mb-2 text-[11px] leading-4 text-neutral-400">
          一行一个播放项，第一行是主来源，其余按顺序播放。地址可粘链接、点上传按钮，或把文件拖到那一行上
          （单文件 {mbText(limits.attachmentMaxMb)}，支持 {avExtsSample(avKind, 5)}），标题会按文件名自动填；
          {isAudio ? "歌词" : "字幕"}挂在行尾按钮里，随{unit}切换。
          {isAudio
            ? "音频一律用站内播放器。"
            : "站内文件与直链用站内播放器，网页地址（B 站 / YouTube 等）自动改用嵌入页。"}
        </p>

        <ul className="space-y-2">
          {main && (
            <AvRowEditor
              key={main.id}
              row={main}
              label={isAudio ? `曲目 1` : `P1`}
              avKind={avKind}
              unit={unit}
              limits={limits}
              isMain
              canRemove={rows.length > 1}
              urlName="avUrl"
              titleName="avTitle"
              fieldErrors={fieldErrors}
              captionErrorKey="caption"
              onPatch={(p) => patch(main.id, p)}
              onRemove={() => remove(main.id)}
              onUploaded={(f) => void onMainUploaded(f)}
              onBusy={setRowBusy}
            />
          )}
          {rest.map((r, i) => (
            <AvRowEditor
              key={r.id}
              row={r}
              label={isAudio ? `曲目 ${i + 2}` : `P${i + 2}`}
              avKind={avKind}
              unit={unit}
              limits={limits}
              fieldErrors={fieldErrors}
              captionErrorKey={`tracks.${i}.caption`}
              onPatch={(p) => patch(r.id, p)}
              onRemove={() => remove(r.id)}
              onBusy={setRowBusy}
            />
          ))}
        </ul>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button type="button" variant="ghost" size="xs" onClick={add}>
            <Plus size={13} aria-hidden />
            添加{unit}
          </Button>
          <span className="text-[11px] text-neutral-400">最多 {AV_TRACKS_MAX} 行</span>
        </div>

        {msg && <p className="mt-1.5 text-xs text-amber-600">{msg}</p>}

        {/* 受控序列化（与 downloads 同款）：地址为空的行不提交，服务端按 avMetaSchema 再校验一次。
            主来源的地址 / 标题是具名输入框（avUrl / avTitle），这里只补它那份字幕与其余行。 */}
        <input type="hidden" name="avMode" value={mode} />
        <input type="hidden" name="avCaption" value={serializeCaptionDraft(main?.caption)} />
        <input type="hidden" name="avTracks" value={serializeAvTracks(rest)} />
        {fieldErr(fieldErrors?.tracks)}
      </div>
    </section>
  );
}
