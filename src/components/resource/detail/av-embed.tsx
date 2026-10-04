"use client";

/**
 * 嵌入页（iframe）音视频播放器 —— **仅多 P 时启用**。
 *
 * 只有 VIDEO 会走到这里：MUSIC 的 mode 在 parseMeta 里恒被钉成 direct，音频没有嵌入页形态，
 * 所以这里也不再有「音频时改成浅底描边」的分支（原 isAudio prop 已删）。
 *
 * 单 P 的嵌入页由详情页（服务端组件）直接渲染一个 iframe，没必要为此多加载一个客户端组件；
 * 只有需要切 P 时才把 iframe 交给客户端状态管理。sandbox / referrerPolicy 与那份保持一字不差
 * （见 av-player.tsx 的单 P 分支），两处改一处忘一处就会开出多余权限。
 *
 * 切 P = 换 src 并换 key：key 变化让 iframe 整体重挂载，避免上一个嵌入页残留的媒体状态
 * （部分站点在内嵌上下文里靠 postMessage 维护播放位置，复用同一个 iframe 会串台）。
 */

import { useState } from "react";
import { AV_IFRAME_SANDBOX } from "@/lib/av";
import { avItemLabel, avUnitLabel, type AvPlayItem } from "@/lib/av-tracks";
import type { AvKind } from "@/lib/av";
import { AvListToggle, AvStepButton, AvTrackList } from "./av-playlist";

export default function AvEmbed({
  items,
  title,
  avKind,
}: {
  items: AvPlayItem[];
  title: string;
  avKind: AvKind;
}) {
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const at = Math.min(idx, items.length - 1);
  const item = items[at];

  return (
    <div>
      <div className="aspect-video w-full bg-black">
        <iframe
          key={item.url}
          src={item.url}
          title={`${title} · ${avItemLabel(item, at, avKind)}`}
          className="h-full w-full"
          sandbox={AV_IFRAME_SANDBOX}
          referrerPolicy="no-referrer"
          loading="lazy"
          allowFullScreen
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5">
          <AvStepButton
            dir={-1}
            avKind={avKind}
            index={at}
            count={items.length}
            onGo={setIdx}
            tone="onSurface"
          />
          <AvStepButton
            dir={1}
            avKind={avKind}
            index={at}
            count={items.length}
            onGo={setIdx}
            tone="onSurface"
          />
        </div>
        <span className="text-xs tabular-nums text-neutral-500">
          {avItemLabel(item, at, avKind)}
        </span>
        <span className="flex-1" />
        <AvListToggle
          open={open}
          index={at}
          count={items.length}
          tone="onSurface"
          label={avUnitLabel(avKind)}
          onToggle={() => setOpen((v) => !v)}
        />
      </div>

      {open && (
        <AvTrackList
          className="mt-2 max-h-[45vh]"
          items={items}
          index={at}
          avKind={avKind}
          tone="onSurface"
          onPick={setIdx}
        />
      )}
    </div>
  );
}
