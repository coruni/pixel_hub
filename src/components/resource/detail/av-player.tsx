// 音视频播放卡 —— 详情页专用（服务端组件，无客户端状态；播放控件在 av-controls.tsx）。
//
// 两种播放方式（形态由地址自动判定，见 lib/av.ts 的 suggestMode）：
//   直链（mode=direct）：自建播放器（自绘控件，替代原生 controls），preload=metadata 只取时长与首帧
//   嵌入页（mode=embed）：sandbox iframe，禁止 top 导航与弹窗，只放行播放所需脚本
// **嵌入页仅服务 VIDEO** —— 音频没有嵌入页形态（parseMeta 把 MUSIC 的 mode 恒归 direct）；
// 音频的站内播放器是唯一形态，没有 iframe 分支。
// 站内来源（/uploads 或 /od 云盘引用）在播放器控件行里嵌一条下载入口：复用 MetaDownloadButton（iconOnly），
// 与其余类型的登录墙 / 下载计数口径一致（/od 由网关 302 到 Graph 预鉴权链接，本站不转发字节）。
//
// 多 P（分P / 曲目）：播放列表由 lib/av-tracks.ts 拼装（存量只有 url 的数据即「单 P」）。
// 列表长度 1 时这里的分支与改造前完全一致；多 P 才启用客户端切换（嵌入页走 av-embed.tsx）。

import {
  ExternalLink,
  FileAudio,
  FileVideo,
  Film,
  Link2,
  ListMusic,
  Music2,
  Subtitles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AV_IFRAME_SANDBOX } from "@/lib/av";
import { avPlaylist, avUnitLabel } from "@/lib/av-tracks";
import { DEFAULT_COVER_URL } from "@/lib/default-cover";
import { AV_CTRL_BTN, AV_CTRL_ON_DARK, AV_CTRL_ON_SURFACE } from "@/lib/ui/cls";
import { MetaDownloadButton } from "@/components/social/interactions";
import AvControls from "./av-controls";
import AvEmbed from "./av-embed";
import type { DetailCtx } from "./parts";

/** 只对能确定含义的扩展名给「格式」标签；嵌入页地址（挂载的是网页）不参与推断 */
const KNOWN_FORMATS: Record<string, string> = {
  mp3: "MP3",
  m4a: "M4A",
  aac: "AAC",
  flac: "FLAC",
  wav: "WAV",
  ogg: "OGG",
  opus: "OPUS",
  wma: "WMA",
  mp4: "MP4",
  webm: "WebM",
  mkv: "MKV",
  mov: "MOV",
  avi: "AVI",
};

function formatOf(url: string, mode: string): string | null {
  if (!url || mode !== "direct") return null;
  const path = url.split(/[?#]/)[0];
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return KNOWN_FORMATS[ext] ?? null;
}

/** 头部元信息格：图标 + 名称 + 值 */
function Chip({ Icon, label, value }: { Icon: LucideIcon; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-none border border-brand-300 bg-surface px-2 py-0.5 text-xs">
      <Icon size={12} className="text-neutral-500" aria-hidden />
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-800">{value}</span>
    </span>
  );
}

/** 音视频资源（MUSIC / VIDEO）的播放卡；其余类型返回 null */
export function AvPlayerBlock({ ctx }: { ctx: DetailCtx }) {
  const { detail, meta, authed } = ctx;
  if (meta.kind !== "MUSIC" && meta.kind !== "VIDEO") return null;
  const isAudio = meta.kind === "MUSIC";
  const KindIcon = isAudio ? Music2 : Film;
  const kindLabel = isAudio ? "音频" : "视频";
  const FormatIcon = isAudio ? FileAudio : FileVideo;
  const avKind = isAudio ? "audio" : "video";

  // 播放列表：tracks 优先，否则退回单条主来源（存量数据即单 P）
  const list = avPlaylist(meta);
  const multi = list.length > 1;
  // 挂了字幕 / 歌词的播放项（每项一份，见 meta.ts 的 avTrackSchema.caption）
  const captioned = list.filter((it) => it.caption?.text.trim());
  // 下载入口指向第一 P（多 P 时列表里不逐条放下载按钮：每项一个 MetaDownloadButton 会重复渲染
  // 登录墙/计数逻辑，收益远低于成本）；命名与「是否站内托管」也按第一 P 判定
  const primaryUrl = list[0]?.url ?? "";
  // 站内路径（/uploads、/od）才提供下载；外链交给「前往来源」按钮，避免把外站当本站文件
  const localFile = primaryUrl.startsWith("/");
  const fileName = primaryUrl.split("/").pop()?.split("?")[0] ?? `${detail.slug}`;
  const format = formatOf(primaryUrl, meta.mode);
  // 封面同时当视频 poster（视频只有一个画面，见 memory：模板层不再单独渲染 Gallery）
  const coverUrl = detail.gallery[0]?.bigUrl ?? DEFAULT_COVER_URL;
  // 下载入口直接嵌进播放器控件行（图标按钮，色调与相邻控件一致）。
  // 只有站内托管的文件才给下载；外链交给「前往来源」，不把外站文件当本站资源。
  const downloadSlot = localFile ? (
    <MetaDownloadButton
      resourceId={detail.id}
      url={primaryUrl}
      name={fileName}
      kind="file"
      iconOnly
      label="下载原件"
      className={`${AV_CTRL_BTN} ${isAudio ? AV_CTRL_ON_SURFACE : AV_CTRL_ON_DARK}`}
      loginRequired={detail.loginRequired}
      authed={authed}
      callbackPath={`/resources/${detail.slug}`}
    />
  ) : null;

  return (
    // mt-6 是「与上一个区块拉开距离」；当播放卡正好是容器首块时不存在上一个块，这个间距就成了
    // 凭空多出的 24px —— video 走 post 模板且不渲染 Gallery（`{!isVideo && <Gallery/>}`），
    // 播放卡正是首块，于是比音频/图片（首块是 Gallery，无上边距）整块下沉。
    // first:mt-0 只在「确实有前驱块」时保留间距：post 视频 / twocol 视频归零，banner（横幅之后）、
    // article（封面/正文之后）不受影响。
    <section className="mt-6 first:mt-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
          <KindIcon size={14} aria-hidden />
          {kindLabel}播放
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {multi && (
            <Chip
              Icon={ListMusic}
              label={avUnitLabel(avKind)}
              value={isAudio ? `${list.length} 首` : `${list.length} P`}
            />
          )}
          {format && <Chip Icon={FormatIcon} label="格式" value={format} />}
          {captioned.length > 0 && (
            <Chip
              Icon={Subtitles}
              label={isAudio ? "歌词" : "字幕"}
              value={
                captioned.length > 1
                  ? `${captioned.length} 项`
                  : captioned[0].caption!.format.toUpperCase()
              }
            />
          )}
        </div>
      </div>

      <div className="mt-3">
        {list.length === 0 ? (
          <p className="rounded-none border border-dashed border-brand-300 px-4 py-6 text-center text-sm text-neutral-500">
            作者未提供播放来源
          </p>
        ) : meta.mode === "embed" && /^https?:\/\//i.test(list[0].url) ? (
          multi ? (
            <AvEmbed items={list} title={detail.title} avKind={avKind} />
          ) : (
            // 单 P 嵌入页：服务端直出，不为此加载客户端组件。
            // sandbox 只放行播放脚本；referrerPolicy 避免把本站地址带给外站
            <div className="aspect-video w-full bg-black">
              <iframe
                src={list[0].url}
                title={`${detail.title} · ${kindLabel}嵌入`}
                className="h-full w-full"
                sandbox={AV_IFRAME_SANDBOX}
                referrerPolicy="no-referrer"
                loading="lazy"
                allowFullScreen
              />
            </div>
          )
        ) : (
          <AvControls
            kind={meta.kind}
            items={list}
            poster={coverUrl}
            title={detail.title}
            downloadSlot={downloadSlot}
          />
        )}
      </div>

      {/* 嵌入页的字幕由来源站点自己的播放器控制，站内挂的这几份用不上——说清楚，别让作者以为挂丢了 */}
      {meta.mode === "embed" && captioned.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-neutral-500">
          <Subtitles size={12} className="mt-0.5 shrink-0" aria-hidden />
          嵌入页播放时字幕由来源站点控制，这里挂载的 {captioned.length} 份不会显示。
        </p>
      )}

      {!localFile && primaryUrl && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <Link2 size={12} aria-hidden />
          该来源由作者外链提供，本站不托管文件。
          <a
            href={primaryUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-brand-700 hover:underline"
          >
            前往来源 <ExternalLink size={11} aria-hidden />
          </a>
        </p>
      )}
    </section>
  );
}
