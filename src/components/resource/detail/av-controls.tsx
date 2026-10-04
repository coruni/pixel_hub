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
 * 视频字幕是压在画面上的叠层，但开关和别的控件一样在底部控件行；音频的歌词板落在卡片里。
 * 同一个开关既切显隐也切歌词板的存亡，不额外做折叠。
 *
 * **视频画面上一律不留浮层按钮**：上一/下一、字幕开关、选集开关全部在底部控件行
 * （音频那行本来就是 flex-wrap，两种形态的位置就此统一）。倍速 / 循环 / 全屏这类设置项
 * 收进行尾的「更多」菜单（见 av-more.tsx）—— 控件行窄屏一行放不下，折行只能兜底，
 * 让高频动作先占住主行。分P 列表：开关在控件条里，面板自己铺开（窄屏贴底铺满画面、
 * 宽屏右下浮层），打开时控件条整条让位。控件自动淡出（仅视频）由状态驱动 —— 详见下方那个 effect。
 * 「列表 / 更多」两个面板互斥且都会暂停淡出计时：面板开着时控件消失会把面板一起带走。
 *
 * 与宿主的契约：`downloadSlot` 是宿主（av-player，服务端组件）注入的控件位——下载入口由宿主渲染
 * （保留登录墙与下载计数的唯一实现），这里只负责把它排进控件行并保证色调一致。多 P 时它指向第一 P。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Gauge,
  ListMusic,
  Loader,
  Maximize,
  Minimize,
  Pause,
  Play,
  Repeat,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  AV_CTRL_BTN as BTN_BASE,
  AV_CTRL_ON_DARK as VIDEO_OFF,
  AV_CTRL_ON_DARK_ACTIVE as VIDEO_ON,
  AV_CTRL_ON_SURFACE as AUDIO_OFF,
  AV_CTRL_ON_SURFACE_ACTIVE as AUDIO_ON,
} from "@/lib/ui/cls";
import { avItemLabel, avUnitLabel, type AvPlayItem } from "@/lib/av-tracks";
import { AvListToggle, AvStepButton, AvTrackList } from "./av-playlist";
import { AvMoreItem, AvMoreMenu } from "./av-more";
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
  const [moreOpen, setMoreOpen] = useState(false);
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
  const armHide = useCallback(() => {
    if (hideRef.current !== null) window.clearTimeout(hideRef.current);
    hideRef.current = window.setTimeout(() => {
      hideRef.current = null;
      setUiOn(false);
    }, HIDE_AFTER_MS);
  }, []);
  const clearHide = useCallback(() => {
    if (hideRef.current !== null) {
      window.clearTimeout(hideRef.current);
      hideRef.current = null;
    }
  }, []);
  /** 任何指针/键盘活动都让控件重新现身并重置计时 */
  const reveal = useCallback(() => {
    setUiOn(true);
    armHide();
  }, [armHide]);
  useEffect(() => clearHide, [clearHide]);

  // 淡出计时器必须由状态驱动，不能只在 pointermove 里补挂 —— 后者会漏掉「播放不由指针触发」的情况
  // （媒体键、列表自动续播），此后指针不再移动，计时器就永远没人补挂 → 控件永不淡出。
  // 任一面板开着时不挂计时：正看着选集 / 菜单，控件消失会把面板一起带走。
  useEffect(() => {
    if (!isVideo || listOpen || moreOpen) {
      clearHide();
      return;
    }
    if (playing) armHide();
    else clearHide();
  }, [isVideo, playing, listOpen, moreOpen, armHide, clearHide]);

  /**
   * 展开 / 收起分P 列表。开关挪到底部控件行后，面板与浮层同生共死，所以这里要顺带管一次计时：
   * 打开时清掉（列表开着不淡出），关闭时按当前播放态补回去 ——
   * 后者正是原实现漏掉的一步：关列表那一刻没有新的 pointermove，计时器早被清空，控件从此再不淡出。
   */
  const toggleList = () => {
    const next = !listOpen;
    setListOpen(next);
    if (next) setMoreOpen(false); // 两个面板互斥：同时开着会叠在画面同一角，也说不清谁压谁
    if (!isVideo) return; // 音频卡片里的控件常驻，不涉及淡出
    setUiOn(true);
    if (!next && playing) armHide();
    else clearHide();
  };

  /** 「更多」菜单同理：开关在控件条里，面板弹出期间不让控件淡出 */
  const toggleMore = () => {
    const next = !moreOpen;
    setMoreOpen(next);
    if (next) setListOpen(false);
    if (!isVideo) return;
    setUiOn(true);
    if (!next && playing) armHide();
    else clearHide();
  };

  /**
   * 面板自己收起的路径（点外部 / Esc）也要把淡出计时补回来：
   * 那一刻同样没有新的 pointermove，而计时器早被上面的 effect 清掉了。
   */
  const closeMore = useCallback(() => {
    setMoreOpen(false);
    if (!isVideo) return;
    setUiOn(true);
    if (playing) armHide();
  }, [isVideo, playing, armHide]);

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
        // 面板展开时不让浮层淡出（计时器由上面的 effect 统一管，这里只别去补挂即可）
        if (listOpen || moreOpen) return;
        // 非播放态（暂停 / 待播 / 播完）控件常驻：只把已经淡出的补回来，不挂计时
        if (!playing) {
          if (!uiOn) {
            clearHide();
            setUiOn(true);
          }
          return;
        }
        reveal();
      }}
      onFocusCapture={() => {
        if (!listOpen && !moreOpen) reveal();
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
          title={playing ? "暂停" : "播放"}
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

        {/* 画面不再放任何浮层按钮：上一/下一、字幕开关、选集开关全部下移到底部控件行（见下方控件区） */}

        {/* 底部控件区 = 字幕 + 控件条。字幕挂在这层外层、控件条自己单独做淡出 ——
            字幕是内容，不该跟着控件一起消失；`bottom-full` 也让它永远贴着控件条上沿，
            控件行在窄屏折成两行时不会被压住。 */}
        <div className="absolute inset-x-0 bottom-0">
          <CaptionLayer text={cap.on ? cueText : null} />
          {/* 列表打开时整条淡出：面板要占满画面（尤其手机），控件条留着也点不到 */}
          <div
            className={`transition-opacity ${
              uiOn && !listOpen ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            <div className="bg-[linear-gradient(to_top,rgba(0,0,0,.85)_0%,rgba(0,0,0,.5)_60%,transparent_100%)] px-3 pb-1.5 pt-8">
              <Bar tone="onDark" label="播放进度" ratio={ratio} buffer={bufRatio} onScrub={seek} />
              {/* 控件全部集中在这一行，画面上一律不留浮层按钮。
                  窄屏一行放不下 10 个控件，所以分「左组（跳转 / 播放 / 时间）」和
                  「右组（显示 / 设置）」两个容器：放不下时右组整体折到第二行，放得下时 spacer 把两组顶到两端。 */}
              <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
                <div className="flex items-center gap-0.5">
                  {multi && (
                    <AvStepButton
                      dir={-1}
                      avKind={avKind}
                      index={at}
                      count={items.length}
                      onGo={goTo}
                      tone="onDark"
                    />
                  )}
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label={playing ? "暂停" : "播放"}
                    title={playing ? "暂停" : "播放"}
                    className={`${BTN_BASE} ${VIDEO_OFF}`}
                  >
                    <PlayIcon size={16} aria-hidden />
                  </button>
                  {multi && (
                    <AvStepButton
                      dir={1}
                      avKind={avKind}
                      index={at}
                      count={items.length}
                      onGo={goTo}
                      tone="onDark"
                    />
                  )}
                  <span className="ml-1.5 shrink-0 text-xs tabular-nums text-white/85">
                    {fmt(current)}
                    {/* 320–374px：控件行本来就满，这里只留当前时间（总长由进度条表达） */}
                    <span className="max-[374px]:hidden"> / {total}</span>
                  </span>
                </div>
                <span className="flex-1" />
                <div className="flex items-center gap-0.5">
                  {capReady && (
                    <CaptionControls
                      on={cap.on}
                      name={capName}
                      tone="onDark"
                      onToggle={cap.toggle}
                    />
                  )}
                  {/* 选集（分P / 曲目）：与嵌入页播放器同一位置 —— 底部控件行 */}
                  {multi && (
                    <AvListToggle
                      open={listOpen}
                      index={at}
                      count={items.length}
                      tone="onDark"
                      onToggle={toggleList}
                    />
                  )}
                  {/* 窄屏藏音量组：控件行容不下，音量交给设备按键 */}
                  <div className="hidden items-center gap-0.5 sm:flex">
                    <div className="w-16">
                      <Bar tone="onDark" label="音量" ratio={volRatio} onScrub={changeVolume} live />
                    </div>
                    <button
                      type="button"
                      onClick={toggleMute}
                      aria-label={muted ? "取消静音" : "静音"}
                      title={muted ? "取消静音" : "静音"}
                      className={`${BTN_BASE} ${muted ? VIDEO_ON : VIDEO_OFF}`}
                    >
                      <VolIcon size={16} aria-hidden />
                    </button>
                  </div>
                  {downloadSlot}
                  {/* 设置项收进「更多」：倍速 / 循环 / 全屏都不是每次播放都要点，
                      留在主行会把 320–374px 挤到折行 */}
                  <AvMoreMenu open={moreOpen} tone="onDark" onToggle={toggleMore} onClose={closeMore}>
                    <AvMoreItem icon={Gauge} label="播放速度" hint={`${rate}×`} onClick={cycleRate} />
                    <AvMoreItem
                      icon={Repeat}
                      label="循环播放"
                      active={loop}
                      onClick={() => setLoop((v) => !v)}
                    />
                    <AvMoreItem
                      icon={fullscreen ? Minimize : Maximize}
                      label={fullscreen ? "退出全屏" : "全屏"}
                      onClick={() => void toggleFullscreen()}
                    />
                  </AvMoreMenu>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 分P / 曲目列表。开关在控件条里，面板自己铺开：
            窄屏贴底铺满画面（手机竖屏视频就 180–220px 高，右下角浮层塞不下两行），
            宽屏回到右下浮层、限高 70%。header 带收起按钮 —— 窄屏面板盖住控件条，必须留个明确出口。 */}
        {multi && listOpen && (
          <AvTrackList
            className="absolute inset-x-0 bottom-0 max-h-full sm:inset-x-auto sm:right-3 sm:w-72 sm:max-h-[70%]"
            items={items}
            index={at}
            avKind={avKind}
            tone="onDark"
            onPick={goTo}
            header={
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/15 px-2.5 py-1.5">
                <span className="flex items-center gap-1.5 text-xs text-white/85">
                  <ListMusic size={13} aria-hidden />
                  {avUnitLabel(avKind)} {at + 1}/{items.length}
                </span>
                <button
                  type="button"
                  onClick={toggleList}
                  aria-label="收起列表"
                  title="收起列表"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-none text-white/80 transition hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            }
          />
        )}

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
            title={playing ? "暂停" : "播放"}
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
            title={muted ? "取消静音" : "静音"}
            className={`${BTN_BASE} ${muted ? AUDIO_ON : AUDIO_OFF}`}
          >
            <VolIcon size={16} aria-hidden />
          </button>
          {multi && (
            <AvListToggle
              open={listOpen}
              index={at}
              count={items.length}
              tone="onSurface"
              onToggle={toggleList}
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
          {/* 与视频同一套：设置项（倍速 / 循环）收进「更多」 */}
          <AvMoreMenu open={moreOpen} tone="onSurface" onToggle={toggleMore} onClose={closeMore}>
            <AvMoreItem icon={Gauge} label="播放速度" hint={`${rate}×`} onClick={cycleRate} />
            <AvMoreItem
              icon={Repeat}
              label="循环播放"
              active={loop}
              onClick={() => setLoop((v) => !v)}
            />
          </AvMoreMenu>
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
          className="mt-3 max-h-[45vh]"
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
