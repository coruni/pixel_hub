"use client";

/**
 * 自建音视频控件（客户端组件，替代原生 controls）。
 *
 * 为什么不用原生 `<audio controls>` / `<video controls>`：UA 外观是「圆角药丸 + 灰渐变底」，
 * 且各浏览器自成一派（Chrome 的 ⋮ 菜单与音量条、Safari 的另一套），既破坏全站直角像素语言，
 * 又因为活在 shadow 内部而无法用 CSS 触及。这里只保留媒体元素本身，控件全部自绘：
 * 可拖拽进度条、可键盘操作的滑块、tabular-nums 时间、音量 / 倍速 / 循环，视频额外有全屏。
 *
 * 形态差异：音频没有画面 → 自己画一张直角卡片（边框 + 控件行）；
 * 视频自带黑底与 16:9 画幅 → 不包边框，控件以底部渐变浮层叠在画面上（鼠标静止 2.6s 自动淡出）。
 *
 * 与宿主的契约：`downloadSlot` 是宿主（av-player，服务端组件）注入的控件位——下载入口由宿主渲染
 * （保留登录墙与下载计数的唯一实现），这里只负责把它排进控件行并保证色调一致。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Loader, Maximize, Minimize, Pause, Play, Repeat, Volume1, Volume2, VolumeX } from "lucide-react";
import {
  AV_CTRL_BTN as BTN_BASE,
  AV_CTRL_ON_DARK as VIDEO_OFF,
  AV_CTRL_ON_DARK_ACTIVE as VIDEO_ON,
  AV_CTRL_ON_SURFACE as AUDIO_OFF,
  AV_CTRL_ON_SURFACE_ACTIVE as AUDIO_ON,
} from "@/lib/ui/cls";

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

/**
 * 直角滑块：4px 轨道 + 3×12px 方形游标，指针拖动 + 键盘（←→ 5%、Home/End）。
 * `live` 为真时拖动过程即时回调（音量）；否则松手才回调（进度条，避免拖动中反复 seek）。
 */
function Bar({
  ratio,
  buffer = 0,
  onScrub,
  label,
  live,
  tone,
  className,
}: {
  ratio: number;
  buffer?: number;
  onScrub: (r: number) => void;
  label: string;
  live?: boolean;
  tone: "onDark" | "onSurface";
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = Math.min(1, Math.max(0, drag ?? ratio));
  const c =
    tone === "onDark"
      ? { track: "bg-white/25", buf: "bg-white/40", fill: "bg-brand-500", knob: "bg-white" }
      : { track: "bg-neutral-200", buf: "bg-neutral-300", fill: "bg-brand-500", knob: "bg-brand-700" };

  const ratioAt = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
  }, []);

  const stopDrag = () => {
    draggingRef.current = false;
    setDrag(null);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        const v = ratioAt(e.clientX);
        setDrag(v);
        if (live) onScrub(v);
      }}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        const v = ratioAt(e.clientX);
        setDrag(v);
        if (live) onScrub(v);
      }}
      onPointerUp={(e: PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        const v = ratioAt(e.clientX);
        stopDrag();
        onScrub(v);
      }}
      onPointerCancel={stopDrag}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        let next: number | null = null;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") next = shown + 0.05;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = shown - 0.05;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = 1;
        if (next === null) return;
        e.preventDefault();
        onScrub(Math.min(1, Math.max(0, next)));
      }}
      className={`relative flex cursor-pointer touch-none items-center py-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
        className ?? ""
      }`}
    >
      <span className={`relative h-1 w-full overflow-hidden ${c.track}`}>
        {buffer > 0 && (
          <span
            className={`absolute inset-y-0 left-0 ${c.buf}`}
            style={{ width: `${Math.min(1, buffer) * 100}%` }}
          />
        )}
        <span className={`absolute inset-y-0 left-0 ${c.fill}`} style={{ width: `${shown * 100}%` }} />
      </span>
      <span
        className={`pointer-events-none absolute top-1/2 h-3 w-[3px] ${c.knob}`}
        style={{ left: `${shown * 100}%`, transform: "translate(-50%, -50%)" }}
      />
    </div>
  );
}

/** 音视频播放器本体（MUSIC / VIDEO 共用） */
export default function AvControls({
  kind,
  src,
  poster,
  title,
  downloadSlot,
}: {
  kind: "MUSIC" | "VIDEO";
  src: string;
  poster?: string;
  title: string;
  /** 宿主注入的控件位（当前放下载入口）：由 av-player 渲染，色调与播放器控件一致，融进同一行 */
  downloadSlot?: ReactNode;
}) {
  const isVideo = kind === "VIDEO";
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hideRef = useRef<number | null>(null);

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
        if (!uiOn) reveal();
        else if (playing) armHide();
      }}
      onFocusCapture={reveal}
    >
      <div className="relative aspect-video w-full">
        <video
          ref={mediaRef as RefObject<HTMLVideoElement | null>}
          src={src}
          poster={poster}
          preload="metadata"
          playsInline
          loop={loop}
          aria-label={title}
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
    <div className="rounded-none border border-brand-200 bg-surface p-4 sm:p-5">
      <audio
        ref={mediaRef as RefObject<HTMLAudioElement | null>}
        src={src}
        preload="metadata"
        loop={loop}
        aria-label={title}
        className="hidden"
        {...mediaEvents}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "暂停" : "播放"}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-none border border-brand-200 bg-brand-50 text-brand-700 transition hover:border-brand-400 hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <PlayIcon
            size={18}
            className={waiting ? "animate-spin motion-reduce:animate-none" : undefined}
            aria-hidden
          />
        </button>
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
          {downloadSlot}
        </div>
      </div>
      {failed && <p className="mt-2 text-xs text-red-600">播放源加载失败，可下载原件后本地播放。</p>}
    </div>
  );
}
