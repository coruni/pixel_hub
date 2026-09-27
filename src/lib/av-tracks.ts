// 音视频「分P / 曲目」的共享纯逻辑（详情页播放器、发布向导、服务端 action 共用）。
// 不依赖 server / node：详情页播放器是客户端组件，这里只能 import 类型与纯函数。
//
// 数据形状的两层：meta 顶层的 title/url/caption 是「主来源」（= 第一 P），
// meta.tracks 是「其余 P」。存量数据只有顶层 url → 播放列表长度为 1，行为与改造前完全一致；
// 列表拼装只在这一个文件里做，播放器 / 向导 / action 都不各自实现一遍。

import type { AvKind } from "@/lib/av";
import { AV_TRACKS_MAX, type AvCaption, type AvResourceMeta } from "@/lib/meta";

/** 播放列表里的一项（序号即数组下标，不单独存） */
export type AvPlayItem = {
  /** 空标题表示作者没填，展示侧回退「P3 / 曲目 3」 */
  title: string;
  url: string;
  /**
   * 本项自己的字幕 / 歌词（视频=字幕叠层，音频=滚动歌词）。
   * **一项一份、随切 P 一起换** —— 不再有「整份资源共用一份、多轨切换」的概念。
   * 空 = 这一项没挂字幕，播放器据此隐藏字幕开关。
   */
  caption?: AvCaption;
};

/**
 * 播放列表 = 主来源（第一 P，已在顶层 url/caption）+ meta.tracks（其余 P）。
 *
 * 「主来源为空但分P 非空」是合法形态（作者可能把每一 P 都填进分P 列表里），此时 tracks 直接
 * 就是整个列表；反过来 tracks 为空就只有主来源一条——存量单 P 数据正好落在这条分支上，
 * 播放列表长度为 1，播放器按「无列表」渲染，行为与改造前一致。
 *
 * 空数组表示「没有可播来源」，宿主据此显示「作者未提供播放来源」。
 */
export function avPlaylist(meta: AvResourceMeta): AvPlayItem[] {
  const tracks = (meta.tracks ?? []).map((t) => ({
    title: t.title,
    url: t.url,
    caption: t.caption,
  }));
  if (!meta.url) return tracks;
  return [{ title: meta.title, url: meta.url, caption: meta.caption }, ...tracks];
}

/** 分P 的统称（音频=曲目，视频=分P），用于列表标题、按钮 tooltip 等文案 */
export function avUnitLabel(avKind: AvKind): string {
  return avKind === "audio" ? "曲目" : "分P";
}

/** 列表项展示名：作者没填标题时回退「P3」/「曲目 3」（音频不叫 P） */
export function avItemLabel(item: AvPlayItem, index: number, avKind: AvKind): string {
  if (item.title.trim()) return item.title.trim();
  return avKind === "audio" ? `曲目 ${index + 1}` : `P${index + 1}`;
}

/** 上一首/下一首（音频）、上一集/下一集（视频）的按钮文案 */
export function avStepLabel(avKind: AvKind, dir: -1 | 1): string {
  if (avKind === "audio") return dir < 0 ? "上一曲" : "下一曲";
  return dir < 0 ? "上一集" : "下一集";
}

/** 从资源类型拿音视频种类（MUSIC→audio / VIDEO→video），供上述文案函数使用 */
export function avKindOfResourceType(type: string): AvKind {
  return type === "MUSIC" ? "audio" : "video";
}

/**
 * 解析表单里的分P JSON（隐藏字段原文）；坏 JSON / 非数组一律返回空数组，绝不抛错。
 * 与 downloads 同款「受控序列化」：向导负责按最终形状序列化，这里只做防御性解析。
 */
export function parseAvTracksJson(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * 序列化：丢掉地址为空的行（用户加了行但没填），并截断到上限。首行是主来源，由调用方单独拆出。
 *
 * 入参刻意比 `AvTrack` 宽松（`caption` 收 null）——表单里的行用 `null` 表示「这一项没挂字幕」，
 * 而落库的 schema 用 `undefined`，中间这层转换就收在这里，别让每个调用方各写一遍。
 */
export function serializeAvTracks(
  tracks: { title: string; url: string; caption?: AvCaption | null }[],
): string {
  return JSON.stringify(
    tracks
      .filter((t) => t.url.trim())
      .slice(0, AV_TRACKS_MAX)
      .map((t) => ({
        title: t.title.trim(),
        url: t.url.trim(),
        // 字幕 / 歌词跟着自己那一行走（见 meta.ts 的 avTrackSchema.caption）
        ...(t.caption?.text.trim() ? { caption: t.caption } : {}),
      })),
  );
}
