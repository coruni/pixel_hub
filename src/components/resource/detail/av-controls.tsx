"use client";

/**
 * 自建音视频控件（客户端组件，替代原生 controls）。
 *
 * 为什么不用原生 `<audio controls>` / `<video controls>`：UA 外观是「圆角药丸 + 灰渐变底」，
 * 且各浏览器自成一派（Chrome 的 ⋮ 菜单与音量条、Safari 的另一套），既破坏全站直角像素语言，
 * 又因为活在 shadow 内部而无法用 CSS 触及。这里只保留媒体元素本身，控件全部自绘：
 * 可拖拽进度条、可键盘操作的滑块（滑块本体见 av-bar.tsx）、tabular-nums 时间、音量 / 倍速 / 循环，
 * 视频额外有全屏。分P 列表的三个部件（上一/下一、列表开关、列表本体）见 av-playlist.tsx。
 *
 * 形态差异：音频没有画面 → 自己画一张直角卡片（边框 + 控件行）；
 * 视频自带黑底与 16:9 画幅 → 不包边框，控件以底部渐变浮层叠在画面上（鼠标静止 2.6s 自动淡出）。
 *
 * 多 P（分P / 曲目）：`items` 是完整播放列表（长度 1 = 单 P，行为与改造前一致）。
 * 上一/下一、列表切换都在本组件里做，切换只改 `<video>/<audio>` 的 src 并 `load()`——
 * 不重新挂载元素，否则列表展开态、倍速、音量会一起被重置。列表最后一项播完自动续下一项（loop 开启时不续）。
 *
 * 字幕 / 歌词（见 av-captions.tsx）：**跟着播放项走** —— 每首曲目 / 每个分P 各带一份，
 * 切 P 即换字幕，没有「整份资源共用一份、多轨切换」的概念。
 * 视频渲染成压在画面上的叠层（开关放在右上角浮层，和分P 列表开关并排 ——
 * 底下那行控件在 320px 已经排满，塞不进第三个按钮）；
 * 音频渲染成卡片内的滚动歌词板（开关进控件行，那行本来就是 flex-wrap）。
 * 同一个开关既切显隐也切歌词板的存亡，不额外做折叠。
 *
 * 与宿主的契约：`downloadSlot` 是宿主（av-player，服务端组件）注入的控件位——下载入口由宿主渲染
 * （保留登录墙与下载计数的唯一实现），这里只负责把它排进控件行并保证色调一致。多 P 时它指向第一 P。
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Loader, Maximize, Minimize, Pause, Play, Repeat, Volume1, Volume2, VolumeX } from "lucide-react";
import {
  AV_CTRL_BTN as BTN_BASE,
  AV_CTRL_ON_DARK as VIDEO_OFF,
  AV_CTRL_ON_DARK_ACTIVE as VIDEO_ON,
  AV_CTRL_ON_SURFACE as AUDIO_OFF,
  AV_CTRL_ON_SURFACE_ACTIVE as AUDIO_ON,
} from "@/lib/ui/cls";
import { avItemLabel, type AvPlayItem } from "@/lib/av-tracks";
import { AvListToggle, AvStepButton, AvTrackList } from "./av-playlist";
import { CaptionControls, CaptionLayer, captionName, cueAt, LyricsPanel, useAvCaption } from "./av-captions";
import Bar from "./av-bar";

/** 倍速档位（循环切换） */
const RATES = [0.5, 1, 1.25, 1.5, 2];
/** 控件自动淡出延迟（仅视频、仅在播放中） */
const HIDE_AFTER_MS = 2600;

/** 秒 → 1:02 / 1:02:03；未知时长返回 --:-- */
function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// —— 控件样式：布局与配色分开，激活态整串替换，避免同属性类名互相覆盖 ——
// 常量统一放 @/lib/ui/cls（宿主 av-player 渲染的下载控件要用同一套色调，见 props.downloadSlot）

/** 音视频播放器本体（MUSIC / VIDEO 共用） */
export default function AvControls({
  kind,
  items,
  poster,
  title,
  downloadSlot,
}: {
  kind: "MUSIC" | "VIDEO";
  /** 播放列表（长度 1 = 单 P）；宿主已保证非空 */
  items: AvPlayItem[];
  poster?: string;
  title: string;
  /** 宿主注入的控件位（当前放下载入口）：由 av-player 渲染，色调与播放器控件一致，融进同一行 */
  downloadSlot?: ReactNode;
}) {
  const isVideo = kind === "VIDEO";
  const avKind = isVideo ? "video" : "audio";
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hideRef = useRef<number | null>(null);
  /** 切 P 后是否要接着播（手动切歌时保留播放态；自然播完自动续下一 P） */
  const wantPlayRef = useRef(false);
  /** 跳过首次挂载的 load()：浏览器已经在加载首 P，再 load 一次等于白跑一趟 */
  const mountedRef = useRef(false);

  const [idx, setIdx] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  // 视频浮层控件的显示态（仅视频用；音频卡片里的控件常驻）
  const [uiOn, setUiOn] = useState(true);

  // items 理论上不会变（详情页一个资源一份列表），但 idx 越界会直接崩在 src 取值上，夹一下更稳
  const at = Math.min(idx, items.length - 1);
  const item = items[at];
  const src = item.url;
  const multi = items.length > 1;
  /** 媒体元素的可访问名：多 P 时带上当前 P，屏幕阅读器才知道切到哪一集了 */
  const mediaLabel = multi ? `${title} · ${avItemLabel(item, at, avKind)}` : title;

  // —— 字幕 / 歌词：**当前播放项自己的那一份**，切 P 时 item 变、解析跟着变（见 useAvCaption）——
  const cap = useAvCaption(item.caption);
  const capName = captionName(avKind);
  const capReady = cap.ready;
  const cueIdx = cueAt(cap.parsed, current, cap.on);
  const cueText = cueIdx >= 0 ? cap.parsed.cues[cueIdx].text : null;

  /** 切到第 n P：保留当前播放态（暂停中就仍是暂停），失败态清掉等新源重新判定 */
  const goTo = (n: number) => {
    if (n < 0 || n >= items.length || n === at) return;
    wantPlayRef.current = !(mediaRef.current?.paused ?? true);
    setIdx(n);
    setFailed(false);
  };

  // 换源：清掉旧的进度/缓冲/时长，再 load() 让浏览器重新解析（只改 src 属性不会重置 buffered）
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const m = mediaRef.current;
    setCurrent(0);
    setBuffered(0);
    setDuration(0);
    setWaiting(false);
    if (!m) return;
    m.load();
    if (wantPlayRef.current) void m.play().catch(() => undefined);
    wantPlayRef.current = false;
  }, [src]);

  /** 视频控件淡出计时器：指针静止一段时间后收起，避免一直压在画面上 */
  const armHide = () => {
    if (hideRef.current !== null) window.clearTimeout(hideRef.current);
    hideRef.current = window.setTimeout(() => {
      hideRef.current = null;
      setUiOn(false);
    }, HIDE_AFTER_MS);
  };
  const clearHide = () => {
    if (hideRef.current !== null) {
      window.clearTimeout(hideRef.current);
      hideRef.current = null;
    }
  };
  /** 任何指针/键盘活动都让控件重新现身并重置计时 */
  const reveal = () => {
    setUiOn(true);
    armHide();
  };
  useEffect(() => clearHide, []);

  // 全屏状态以 document 为准（Esc 退出、浏览器原生按钮退出都要同步回按钮图标）
  useEffect(() => {
    const onFsChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // —— 媒体事件：一律从元素上读真值，不推断 ——
  const syncProgress = () => {
    const m = mediaRef.current;
    if (!m) return;
    setCurrent(m.currentTime);
    const b = m.buffered;
    if (b.length > 0) setBuffered(b.end(b.length - 1));
  };
  const syncDuration = () => {
    const m = mediaRef.current;
    if (m) setDuration(m.duration);
  };
  const syncTracks = () => {
    const m = mediaRef.current;
    if (!m) return;
    setVolume(m.volume);
    setMuted(m.muted);
    setRate(m.playbackRate);
  };
  const onPlay = () => {
    setPlaying(true);
    setWaiting(false);
    reveal();
  };
  const onPause = () => {
    setPlaying(false);
    setWaiting(false);
    clearHide();
    setUiOn(true);
  };
  const onEnded = () => {
    // 多 P：播完自动续下一 P。开了循环时 ended 根本不触发（元素自己循环）——那是「单曲循环」的口径。
    if (at < items.length - 1) {
      wantPlayRef.current = true;
      setIdx(at + 1);
      return;
    }
    setPlaying(false);
    clearHide();
    setUiOn(true);
  };

  // —— 操作 ——
  const toggle = () => {
    const m = mediaRef.current;
    if (!m) return;
    if (m.paused)
      // 播放被拒（自动播放策略 / 解码失败）不在这里报错：真失败会走 onError 显示占位提示
      void m.play().catch(() => undefined);
    else m.pause();
  };
  const seek = (r: number) => {
    const m = mediaRef.current;
    if (!m || !Number.isFinite(m.duration) || m.duration <= 0) return;
    const t = r * m.duration;
    m.currentTime = t;
    setCurrent(t);
  };
  /** 按绝对秒跳转（歌词行点击）；与进度条不同，这里不经过 0..1 比例换算 */
  const seekTo = (sec: number) => {
    const m = mediaRef.current;
    if (!m || !Number.isFinite(sec)) return;
    m.currentTime = sec;
    setCurrent(sec);
  };
  const changeVolume = (r: number) => {
    const m = mediaRef.current;
    if (!m) return;
    const v = Math.min(1, Math.max(0, r));
    m.volume = v;
    m.muted = v === 0;
  };
  const toggleMute = () => {
    const m = mediaRef.current;
    if (m) m.muted = !m.muted;
  };
  const cycleRate = () => {
    const m = mediaRef.current;
    if (!m) return;
    m.playbackRate = RATES[(RATES.indexOf(m.playbackRate) + 1) % RATES.length];
  };
  const toggleFullscreen = async () => {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      // 用户拒绝或被浏览器策略禁止：保持原状即可
    }
  };

  const total = Number.isFinite(duration) && duration > 0 ? fmt(duration) : "--:--";
  const ratio = duration > 0 ? Math.min(1, current / duration) : 0;
  const bufRatio = duration > 0 ? Math.min(1, buffered / duration) : 0;
  const volRatio = muted ? 0 : volume;
  const VolIcon = volRatio === 0 ? VolumeX : volRatio < 0.5 ? Volume1 : Volume2;
  const PlayIcon = waiting ? Loader : playing ? Pause : Play;
  const showBadge = waiting || !playing;

  const mediaEvents = {
    onPlay,
    onPause,
    onEnded,
    onTimeUpdate: syncProgress,
    onProgress: syncProgress,
    onDurationChange: syncDuration,
    onLoadedMetadata: () => {
      syncDuration();
      syncTracks();
    },
    onVolumeChange: syncTracks,
    onRateChange: syncTracks,
    onWaiting: () => setWaiting(true),
    onPlaying: () => {
      setWaiting(false);
      syncProgress();
    },
    onCanPlay: () => setWaiting(false),
    onError: () => {
      setFailed(true);
      setWaiting(false);
    },
  };

  return isVideo ? (
    <div
      ref={shellRef}
      className="relative bg-black"
      onPointerMove={() => {
        // 列表展开时不让浮层淡出：正看着选集，控件消失会把面板一起带走
        if (listOpen) {
          setUiOn(true);
          clearHide();
        } else if (!uiOn) reveal();
        else if (playing) armHide();
      }}
      onFocusCapture={() => {
        if (!listOpen) reveal();
      }}
    >
      <div className="relative aspect-video w-full">
        <video
          ref={mediaRef as RefObject<HTMLVideoElement | null>}
          src={src}
          poster={poster}
          preload="metadata"
          playsInline
          loop={loop}
          aria-label={mediaLabel}
          className="block h-full w-full bg-black"
          {...mediaEvents}
        />
        {/* 画面点击 = 播放/暂停；暂停或缓冲时中央显示图标（播放中鼠标悬停才淡入） */}
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "暂停" : "播放"}
          className="group/av absolute inset-0 grid place-items-center focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
        >
          <span
            className={`grid h-14 w-14 place-items-center rounded-none border border-white/40 bg-black/55 text-white transition-opacity ${
              showBadge ? "opacity-100" : "opacity-0 group-hover/av:opacity-100"
            }`}
          >
            <PlayIcon
              size={22}
              className={waiting ? "animate-spin motion-reduce:animate-none" : undefined}
              aria-hidden
            />
          </span>
        </button>

        {/* 字幕叠层：压在画面底部、控件行之上（bottom-14 正好避开那行渐变浮层）。
            指针穿透，不挡画面点击。 */}
        <CaptionLayer text={cap.on ? cueText : null} />

        {/* 多 P 浮层：上一/下一在画面两侧。
            不放进下方控件行是有原因的——320px 下那一行已经排满，再塞两个按钮必然横向溢出。 */}
        {multi && (
          <>
            <div
              className={`absolute left-2 top-1/2 -translate-y-1/2 border border-white/25 bg-black/55 transition-opacity ${
                uiOn ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <AvStepButton
                dir={-1}
                avKind={avKind}
                index={at}
                count={items.length}
                onGo={goTo}
                tone="onDark"
                size="lg"
              />
            </div>
            <div
              className={`absolute right-2 top-1/2 -translate-y-1/2 border border-white/25 bg-black/55 transition-opacity ${
                uiOn ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <AvStepButton
                dir={1}
                avKind={avKind}
                index={at}
                count={items.length}
                onGo={goTo}
                tone="onDark"
                size="lg"
              />
            </div>
          </>
        )}

        {/* 右上角：字幕开关 + 分P 列表开关并排（两者都是压在画面上的大按钮，尺寸必须同一档） */}
        {(multi || capReady) && (
          <div
            className={`absolute right-2 top-2 flex items-center gap-0.5 border border-white/25 bg-black/55 px-0.5 transition-opacity ${
              uiOn ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            {capReady && (
              <CaptionControls
                on={cap.on}
                name={capName}
                tone="onDark"
                onToggle={cap.toggle}
                size="lg"
              />
            )}
            {multi && (
              <AvListToggle
                open={listOpen}
                index={at}
                count={items.length}
                tone="onDark"
                size="lg"
                onToggle={() => setListOpen((v) => !v)}
              />
            )}
          </div>
        )}

        {multi && listOpen && (
          <AvTrackList
            className="absolute right-2 top-14 w-56 max-w-[calc(100%-1rem)]"
            style={{ maxHeight: "62%" }}
            items={items}
            index={at}
            avKind={avKind}
            tone="onDark"
            onPick={goTo}
          />
        )}

        <div
          className={`absolute inset-x-0 bottom-0 transition-opacity ${
            uiOn ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div className="bg-[linear-gradient(to_top,rgba(0,0,0,.85)_0%,rgba(0,0,0,.5)_60%,transparent_100%)] px-3 pb-1.5 pt-8">
            <Bar tone="onDark" label="播放进度" ratio={ratio} buffer={bufRatio} onScrub={seek} />
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? "暂停" : "播放"}
                className={`${BTN_BASE} ${VIDEO_OFF}`}
              >
                <PlayIcon size={16} aria-hidden />
              </button>
              <span className="ml-1.5 shrink-0 text-xs tabular-nums text-white/85">
                {fmt(current)} / {total}
              </span>
              <span className="flex-1" />
              {/* 窄屏藏音量组：320px 下控件行容不下，音量交给设备按键 */}
              <div className="hidden items-center gap-0.5 sm:flex">
                <div className="w-16">
                  <Bar tone="onDark" label="音量" ratio={volRatio} onScrub={changeVolume} live />
                </div>
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={muted ? "取消静音" : "静音"}
                  className={`${BTN_BASE} ${muted ? VIDEO_ON : VIDEO_OFF}`}
                >
                  <VolIcon size={16} aria-hidden />
                </button>
              </div>
              <button
                type="button"
                onClick={cycleRate}
                aria-label={`播放速度 ${rate} 倍`}
                className={`${BTN_BASE} min-w-[46px] px-1 text-xs tabular-nums ${VIDEO_OFF}`}
              >
                {rate}×
              </button>
              <button
                type="button"
                onClick={() => setLoop((v) => !v)}
                aria-pressed={loop}
                aria-label="循环播放"
                className={`${BTN_BASE} ${loop ? VIDEO_ON : VIDEO_OFF}`}
              >
                <Repeat size={16} aria-hidden />
              </button>
              {downloadSlot}
              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                aria-label={fullscreen ? "退出全屏" : "全屏"}
                className={`${BTN_BASE} ${VIDEO_OFF}`}
              >
                {fullscreen ? <Minimize size={16} aria-hidden /> : <Maximize size={16} aria-hidden />}
              </button>
            </div>
          </div>
        </div>

        {failed && (
          <p className="absolute inset-x-0 top-0 bg-red-600/90 px-3 py-1.5 text-xs text-white">
            播放源加载失败，可下载原件后本地播放。
          </p>
        )}
      </div>
    </div>
  ) : (
    <div className="rounded-none border border-brand-300 bg-surface p-4 sm:p-5">
      <audio
        ref={mediaRef as RefObject<HTMLAudioElement | null>}
        src={src}
        preload="metadata"
        loop={loop}
        aria-label={mediaLabel}
        className="hidden"
        {...mediaEvents}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex shrink-0 items-center gap-0.5">
          {multi && (
            <AvStepButton
              dir={-1}
              avKind={avKind}
              index={at}
              count={items.length}
              onGo={goTo}
              tone="onSurface"
            />
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "暂停" : "播放"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-none border border-brand-300 bg-brand-50 text-brand-700 transition hover:border-brand-500 hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <PlayIcon
              size={18}
              className={waiting ? "animate-spin motion-reduce:animate-none" : undefined}
              aria-hidden
            />
          </button>
          {multi && (
            <AvStepButton
              dir={1}
              avKind={avKind}
              index={at}
              count={items.length}
              onGo={goTo}
              tone="onSurface"
            />
          )}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-neutral-500">
          {fmt(current)} / {total}
        </span>
        <Bar
          className="min-w-[120px] flex-1"
          tone="onSurface"
          label="播放进度"
          ratio={ratio}
          buffer={bufRatio}
          onScrub={seek}
        />
        <div className="flex items-center gap-0.5">
          <div className="hidden w-16 sm:block">
            <Bar tone="onSurface" label="音量" ratio={volRatio} onScrub={changeVolume} live />
          </div>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "取消静音" : "静音"}
            className={`${BTN_BASE} ${muted ? AUDIO_ON : AUDIO_OFF}`}
          >
            <VolIcon size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={cycleRate}
            aria-label={`播放速度 ${rate} 倍`}
            className={`${BTN_BASE} min-w-[46px] px-1 text-xs tabular-nums ${AUDIO_OFF}`}
          >
            {rate}×
          </button>
          <button
            type="button"
            onClick={() => setLoop((v) => !v)}
            aria-pressed={loop}
            aria-label="循环播放"
            className={`${BTN_BASE} ${loop ? AUDIO_ON : AUDIO_OFF}`}
          >
            <Repeat size={16} aria-hidden />
          </button>
          {multi && (
            <AvListToggle
              open={listOpen}
              index={at}
              count={items.length}
              tone="onSurface"
              onToggle={() => setListOpen((v) => !v)}
            />
          )}
          {capReady && (
            <CaptionControls
              on={cap.on}
              name={capName}
              tone="onSurface"
              onToggle={cap.toggle}
            />
          )}
          {downloadSlot}
        </div>
      </div>
      {/* 歌词板：与视频的字幕叠层同一份 cue 数据，只是换成可滚动列表。
          开关就是控件行里那个按钮 —— 关掉即整块收起，不再另做折叠。 */}
      {cap.on && capReady && (
        <LyricsPanel className="mt-3" parsed={cap.parsed} active={cueIdx} onSeek={seekTo} />
      )}
      {/* 音频卡片里的列表常驻在卡片内（不像视频那样浮在画面上）：卡片本来就占位，撑开即可 */}
      {multi && listOpen && (
        <AvTrackList
          className="mt-3"
          items={items}
          index={at}
          avKind={avKind}
          tone="onSurface"
          onPick={goTo}
        />
      )}
      {failed && <p className="mt-2 text-xs text-red-600">播放源加载失败，可下载原件后本地播放。</p>}
    </div>
  );
}
