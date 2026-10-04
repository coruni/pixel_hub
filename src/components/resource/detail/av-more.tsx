"use client";

/**
 * 播放器控件行里的「更多」溢出菜单 —— 直链播放器的视频 / 音频两种形态共用。
 *
 * 为什么要有它：控件行上的按钮已经多到窄屏一行放不下（320–374px 尤其紧，只能靠折行兜底）。
 * 倍速 / 循环 / 全屏这类「设置项」不是每次播放都要点，收进这里，把行让给播放、跳转、
 * 选集这些高频动作 —— 位置和配色与相邻控件完全一致，只是多一层弹出。
 *
 * 状态由宿主持有（`open` / `onToggle` / `onClose`）而不是内部自管：
 * 视频控件会在鼠标静止后自动淡出，宿主必须知道面板开着才能暂停那个计时器 ——
 * 否则指针停在菜单上不动，菜单会跟着控件一起消失。
 *
 * 面板**自下往上**弹（`bottom-full`）：控件条贴在画面底部，往下弹会被画面边界裁掉。
 */

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { Check, MoreHorizontal, type LucideIcon } from "lucide-react";
import { AV_CTRL_BTN as BTN } from "@/lib/ui/cls";
import { AV_TONE, type AvTone } from "./av-btn";

/** 面板与行的配色跟着控件走，不必逐项传 tone —— 由 AvMoreMenu 注入，AvMoreItem 取用 */
const MenuCtx = createContext<{ tone: AvTone; close: () => void } | null>(null);

/** 面板底：与分P 列表同一套（暗色压在画面上，亮色落在暖白卡片里），不另造一套浮层皮肤 */
const PANEL: Record<AvTone, string> = {
  onDark: "border-white/20 bg-black/85 text-white/90",
  onSurface: "border-brand-300 bg-surface text-neutral-700",
};

const ROW: Record<AvTone, { idle: string; active: string; icon: string }> = {
  onDark: { idle: "hover:bg-white/15 hover:text-white", active: "bg-white/20 text-white", icon: "text-white/70" },
  onSurface: {
    idle: "hover:bg-brand-50 hover:text-brand-700",
    active: "bg-brand-100 text-brand-800",
    icon: "text-neutral-500",
  },
};

/**
 * 触发按钮 + 弹出面板。`children` 是 `AvMoreItem`（或任意行）。
 * 收起方式：点面板外、按 Esc、点任意一项（选完就收，和系统菜单一致）。
 */
export function AvMoreMenu({
  open,
  tone,
  onToggle,
  onClose,
  children,
}: {
  open: boolean;
  tone: AvTone;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="更多"
        title="更多"
        className={`${BTN} ${open ? AV_TONE[tone].on : AV_TONE[tone].off}`}
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="更多"
          // min-w 兜住「播放速度 1.25×」这类一行文案；max-w 防窄屏把面板顶出画面
          className={`absolute bottom-full right-0 z-20 mb-1 min-w-36 max-w-[80vw] rounded-none border py-1 ${PANEL[tone]}`}
        >
          <MenuCtx.Provider value={{ tone, close: onClose }}>{children}</MenuCtx.Provider>
        </div>
      )}
    </div>
  );
}

/**
 * 菜单里的一行。`hint` 放右侧的当前值（倍速的「1.25×」），
 * `active` 只给**开关型**项（循环播放）—— 传了它这行就是 `menuitemcheckbox`
 * （`aria-pressed` 在 `menuitem` 上是不合法的，读屏也会当成按下的按钮）；
 * 一次性动作（全屏、倍速）别传 `active`，保持普通 `menuitem`。
 */
export function AvMoreItem({
  icon: Icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  const ctx = useContext(MenuCtx);
  const s = ROW[ctx?.tone ?? "onDark"];
  const toggle = active !== undefined;
  return (
    <button
      type="button"
      role={toggle ? "menuitemcheckbox" : "menuitem"}
      aria-checked={toggle ? active : undefined}
      onClick={() => {
        onClick();
        ctx?.close();
      }}
      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition ${
        active ? s.active : s.idle
      }`}
    >
      {Icon && <Icon size={14} className={`shrink-0 ${s.icon}`} aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className={`shrink-0 tabular-nums ${s.icon}`}>{hint}</span>}
      {active && <Check size={13} className="shrink-0" aria-hidden />}
    </button>
  );
}
