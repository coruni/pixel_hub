// 音视频播放卡 —— 详情页专用（服务端组件，无客户端状态；播放控件在 av-controls.tsx）。
//
// 两种来源形态对应两种播放方式：
//   直链（mode=direct）：自建播放器（自绘控件，替代原生 controls），preload=metadata 只取时长与首帧
//   嵌入页（mode=embed）：sandbox iframe，禁止 top 导航与弹窗，只放行播放所需脚本
// 站内来源（/uploads 或 /od 云盘引用）在播放器控件行里嵌一条下载入口：复用 MetaDownloadButton（iconOnly），
// 与其余类型的登录墙 / 下载计数口径一致（/od 由网关 302 到 Graph 预鉴权链接，本站不转发字节）。

import { Clock, ExternalLink, FileAudio, FileVideo, Film, Link2, MonitorPlay, Music2, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AV_IFRAME_SANDBOX } from "@/lib/av";
import { AV_CTRL_BTN, AV_CTRL_ON_DARK, AV_CTRL_ON_SURFACE } from "@/lib/ui/cls";
import { MetaDownloadButton } from "@/components/social/interactions";
import AvControls from "./av-controls";
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
    <span className="inline-flex items-center gap-1 rounded-none border border-brand-200 bg-surface px-2 py-0.5 text-xs">
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

  // 站内路径（/uploads、/od）才提供下载；外链交给「前往来源」按钮，避免把外站当本站文件
  const localFile = meta.url.startsWith("/");
  const fileName = meta.url.split("/").pop()?.split("?")[0] ?? `${detail.slug}`;
  const format = formatOf(meta.url, meta.mode);
  // 封面同时当视频 poster（视频只有一个画面，见 memory：模板层不再单独渲染 Gallery）
  const coverUrl = detail.gallery[0]?.bigUrl;
  // 下载入口直接嵌进播放器控件行（图标按钮，色调与相邻控件一致）。
  // 只有站内托管的文件才给下载；外链交给「前往来源」，不把外站文件当本站资源。
  const downloadSlot = localFile ? (
    <MetaDownloadButton
      resourceId={detail.id}
      url={meta.url}
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
          {meta.duration && <Chip Icon={Clock} label="时长" value={meta.duration} />}
          {format && <Chip Icon={FormatIcon} label="格式" value={format} />}
          {isAudio && meta.artist && <Chip Icon={User} label="艺术家" value={meta.artist} />}
          {!isAudio && meta.resolution && <Chip Icon={MonitorPlay} label="画质" value={meta.resolution} />}
        </div>
      </div>

      <div className="mt-3">
        {!meta.url ? (
          <p className="rounded-none border border-dashed border-brand-200 px-4 py-6 text-center text-sm text-neutral-500">
            作者未提供播放来源
          </p>
        ) : meta.mode === "embed" && /^https?:\/\//i.test(meta.url) ? (
          // 嵌入页：sandbox 只放行播放脚本；referrerPolicy 避免把本站地址带给外站
          <div
            className={
              isAudio
                ? "aspect-video w-full border border-brand-200 bg-neutral-100"
                : "aspect-video w-full bg-black"
            }
          >
            <iframe
              src={meta.url}
              title={`${detail.title} · ${kindLabel}嵌入`}
              className="h-full w-full"
              sandbox={AV_IFRAME_SANDBOX}
              referrerPolicy="no-referrer"
              loading="lazy"
              allowFullScreen
            />
          </div>
        ) : (
          // key=url：换资源时整体重挂载，避免旧元素的播放进度/音量串到新文件上
          <AvControls
            key={meta.url}
            kind={meta.kind}
            src={meta.url}
            poster={coverUrl}
            title={detail.title}
            downloadSlot={downloadSlot}
          />
        )}
      </div>

      {!localFile && meta.url && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <Link2 size={12} aria-hidden />
          该来源由作者外链提供，本站不托管文件。
          <a
            href={meta.url}
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
