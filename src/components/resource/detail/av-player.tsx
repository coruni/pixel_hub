// 音视频播放卡 —— 详情页专用（服务端组件，无客户端状态）。
//
// 两种来源形态对应两种播放方式：
//   直链（mode=direct）：原生 <audio>/<video>，preload=metadata 只取时长与首帧，不预载整段
//   嵌入页（mode=embed）：sandbox iframe，禁止 top 导航与弹窗，只放行播放所需脚本
// 站内来源（/uploads 或 /od 云盘引用）额外给一条下载入口：复用 MetaDownloadButton，
// 与其余类型的登录墙 / 下载计数口径一致（/od 由网关 302 到 Graph 预鉴权链接，本站不转发字节）。

import { Clock, Download, ExternalLink, Film, Link2, Music2, User } from "lucide-react";
import { AV_IFRAME_SANDBOX } from "@/lib/av";
import { MetaDownloadButton } from "@/components/social/interactions";
import type { DetailCtx } from "./parts";

/** 展示用键值行 */
function KV({ k, v }: { k: string; v: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
      <span className="text-neutral-400">{k}</span>
      <span className="text-neutral-800">{v}</span>
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

  // 站内路径（/uploads、/od）才提供下载；外链交给「前往来源」按钮，避免把外站当本站文件
  const localFile = meta.url.startsWith("/");
  const fileName = meta.url.split("/").pop()?.split("?")[0] ?? `${detail.slug}`;

  return (
    <section className="mt-6 rounded-none border border-brand-200 bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-400">
          <KindIcon size={14} aria-hidden />
          {kindLabel}播放
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {meta.duration && (
            <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
              <Clock size={12} aria-hidden /> {meta.duration}
            </span>
          )}
          {isAudio && meta.artist && (
            <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
              <User size={12} aria-hidden /> {meta.artist}
            </span>
          )}
          {!isAudio && meta.resolution && <KV k="画质" v={meta.resolution} />}
        </div>
      </div>

      <div className="mt-3">
        {!meta.url ? (
          <p className="rounded-none border border-dashed border-brand-200 px-4 py-6 text-center text-sm text-neutral-400">
            作者未提供播放来源
          </p>
        ) : meta.mode === "embed" && /^https?:\/\//i.test(meta.url) ? (
          // 嵌入页：sandbox 只放行播放脚本；referrerPolicy 避免把本站地址带给外站
          <div className="aspect-video w-full border border-brand-200 bg-neutral-100">
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
        ) : isAudio ? (
          <audio controls preload="metadata" src={meta.url} className="w-full">
            你的浏览器不支持音频播放。
          </audio>
        ) : (
          <video
            controls
            preload="metadata"
            playsInline
            src={meta.url}
            className="aspect-video w-full border border-brand-200 bg-black"
          >
            你的浏览器不支持视频播放。
          </video>
        )}
      </div>

      {/* 站内来源：可下载原件（走统一下载入口，登录墙与计数一致） */}
      {localFile && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <MetaDownloadButton
            resourceId={detail.id}
            url={meta.url}
            name={fileName}
            kind="file"
            label="下载"
            loginRequired={detail.loginRequired}
            authed={authed}
            callbackPath={`/resources/${detail.slug}`}
          />
          <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
            <Download size={12} aria-hidden /> 站内托管，可直接下载原件
          </span>
        </div>
      )}
      {!localFile && meta.url && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-neutral-400">
          <Link2 size={12} aria-hidden />
          作者以
          {meta.mode === "embed" ? "嵌入页" : "外链直链"}
          挂载，本站不托管该文件。
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
