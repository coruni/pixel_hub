"use client";

// 音乐 / 视频分节 —— 发布向导与后台改稿共用。
//
// 表单形状就是一个「播放项」列表，与 lib/av-tracks.ts 的 avPlaylist 完全同构：
//   第 1 行 = 主来源（落 meta.title / meta.url / meta.caption）
//   其余行 = 分P / 曲目（落 meta.tracks[]，每行含自己的标题、地址与字幕）
// 每行在列表里只显示标题 + 行尾设置图标，地址、上传、歌词 / 字幕都在那颗图标打开的抽屉里。
//
// 没有「上传模式」选择：地址框里既能手填链接，也能点上传按钮传文件（上传完回填站内地址）。
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
import { useFileDrop } from "@/lib/hooks/use-file-drop";
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
   * 区块级投放区。
   *
   * 为什么不能只让每一行当投放区：一行只有 30 来像素高，作者拖文件时十有八九落在说明文字、
   * 行间空隙或「添加」按钮上——那里浏览器根本不认投放目标，手感就是「这块不能拖」。
   * 所以把区块里**除列表以外**的可见区域（上方说明 + 下方添加行）也接上，落点是主来源。
   *
   * 这两块必须与 `<ul>` **互为兄弟**：一旦某个祖先把 `<ul>` 包进投放区就成了嵌套，
   * 拖到行上会被内外各接一次（同一个文件既进主来源又进那一行），而给内层截断传播又会
   * 让外层的高亮永久复位不了——细节见 lib/hooks/use-file-drop.ts 的文件头。
   */
  const mainUploadRef = useRef<((file: File) => void) | null>(null);
  const { dragging: zoneDragging, dropProps: zoneDropProps } = useFileDrop({
    onFiles: (fl) => {
      if (fl.length > 1) {
        setMsg(`一次接一个文件（已取第 1 个）；再加${unit}请点下面的「添加${unit}」`);
      } else {
        setMsg(null);
      }
      const f = fl[0];
      if (f) mainUploadRef.current?.(f);
    },
    disabled: busyIds.length > 0,
  });
  const zoneHot = zoneDragging ? "bg-brand-50 ring-2 ring-brand-300" : "";

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
        {/* 上方说明区：与下面的 <ul> 平级，是区块级投放区的一部分（落点上见 mainUploadRef 那段注释） */}
        <div {...zoneDropProps} className={`transition ${zoneHot}`}>
          <span className={wizLabel}>{unit}列表</span>
          <p className="mb-2 text-[11px] leading-4 text-neutral-400">
            一行一个播放项，第一行是主来源，其余按顺序播放。行上只显示标题，改地址、传文件、挂
            {isAudio ? "歌词" : "字幕"}都点行尾的设置按钮。也可以直接把文件拖进来 —— 拖在本区块上
            {isAudio ? "即上传为「曲目 1」" : "即上传为「P1」"}，拖到某一{unit}上则替换那一项，标题会按文件名自动填
            （一次一个文件，单文件 {mbText(limits.attachmentMaxMb)}，支持 {avExtsSample(avKind, 5)}）。
            {isAudio
              ? "音频一律用站内播放器。"
              : "站内文件与直链用站内播放器，网页地址（B 站 / YouTube 等）自动改用嵌入页。"}
          </p>
        </div>

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
              fieldErrors={fieldErrors}
              captionErrorKey="caption"
              onPatch={(p) => patch(main.id, p)}
              onRemove={() => remove(main.id)}
              onUploaded={(f) => void onMainUploaded(f)}
              onBusy={setRowBusy}
              uploadRef={mainUploadRef}
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

        {/* 下方操作行：区块级投放区的另一半，同样与 <ul> 平级 */}
        <div {...zoneDropProps} className={`mt-2 flex flex-wrap items-center gap-3 transition ${zoneHot}`}>
          <Button type="button" variant="ghost" size="xs" onClick={add}>
            <Plus size={13} aria-hidden />
            添加{unit}
          </Button>
          <span className={`text-[11px] ${zoneDragging ? "font-medium text-brand-700" : "text-neutral-400"}`}>
            {zoneDragging
              ? isAudio
                ? "松开即上传为「曲目 1」"
                : "松开即上传为「P1」"
              : `最多 ${AV_TRACKS_MAX} 行`}
          </span>
        </div>

        {msg && <p className="mt-1.5 text-xs text-amber-600">{msg}</p>}

        {/* 受控序列化（与 downloads 同款）：地址为空的行不提交，服务端按 avMetaSchema 再校验一次。
            主来源的标题 / 地址 / 字幕与其余行**全部**在这里序列化 —— 行上的编辑控件都收在抽屉里、
            关着时不渲染，字段若挂在那边一关抽屉就丢值。 */}
        <input type="hidden" name="avMode" value={mode} />
        <input type="hidden" name="avTitle" value={main?.title ?? ""} />
        <input type="hidden" name="avUrl" value={main?.url ?? ""} />
        <input type="hidden" name="avCaption" value={serializeCaptionDraft(main?.caption)} />
        <input type="hidden" name="avTracks" value={serializeAvTracks(rest)} />
        {fieldErr(fieldErrors?.tracks)}
      </div>
    </section>
  );
}
