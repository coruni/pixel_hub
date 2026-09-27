"use client";

// 「简洁模式」的入口共用这一份状态逻辑（偏好本身的读写见 lib/simple-mode.ts 顶部注释）：
//   · SimpleModeToggle —— 顶栏方形图标按钮（≥sm，与旁边搜索框/头像同高）
//   · SimpleModeRow    —— 带文字与开关的整行按钮（<sm 的汉堡抽屉、设置页「外观」）
//
// 【为什么要广播事件】两处入口可能**同时挂载**（桌面端抽屉那一份仍在 DOM 里，只是被
// sm:hidden 藏着），各自持一份 state。只改自己的话，缩小窗口换到另一断点时那份还是旧状态。
// 所以切换后广播一个自定义事件，让另一份把状态从 DOM 重读一遍 —— 属性是唯一事实来源。
import { useCallback, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { NAV_ICON_BTN } from "@/lib/ui/cls";
import { applySimpleBg, readSimpleBg, writeSimpleBgCookie } from "@/lib/simple-mode";

const CHANGE_EVENT = "simple-bg-change";
const EXPLAIN = "隐藏全站背景图（全局背景 / 资源页作者背景 / 个人主页背景）";

function useSimpleMode(initialOn: boolean) {
  const [on, setOn] = useState(initialOn);

  useEffect(() => {
    // 以 DOM 上的属性为准：服务端已按 cookie 写好，另一入口先切过也在这里对齐
    const sync = () => setOn(readSimpleBg());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  const toggle = useCallback(() => {
    const next = !readSimpleBg();
    applySimpleBg(next);
    writeSimpleBgCookie(next);
    setOn(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { on, toggle };
}

/** 顶栏入口：方形图标按钮，开/关靠 aria-pressed + 描边/底色区分。
 *  形状上只在 ≥sm 出现（<sm 走汉堡抽屉里那一行）—— 用 `max-sm:hidden` 而不是 `hidden sm:grid`，
 *  免得 NAV_ICON_BTN 自带的 `grid` 与 `hidden` 这两个 display 工具类拼在一起、靠产物顺序定胜负。 */
export function SimpleModeToggle({ initialOn }: { initialOn: boolean }) {
  const { on, toggle } = useSimpleMode(initialOn);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label="简洁模式"
      title={`简洁模式：${EXPLAIN}`}
      className={`${NAV_ICON_BTN} max-sm:hidden rounded-none border transition ${
        on
          ? "border-brand-600 bg-brand-50 text-brand-700"
          : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-500 hover:text-neutral-900"
      }`}
    >
      <ImageOff size={16} aria-hidden />
    </button>
  );
}

/** 整行入口：左侧文案 + 右侧开关，容器样式（内边距/描边/hover）由调用方给 */
export function SimpleModeRow({
  initialOn,
  label = "简洁模式",
  hint,
  className = "",
  onChanged,
}: {
  initialOn: boolean;
  label?: string;
  /** 补充说明；不传则只显示标题 */
  hint?: string;
  /** 容器附加样式（抽屉行 / 设置卡片行的差异只在这里） */
  className?: string;
  /** 切换后的副作用，例如关掉已经遮住页面的抽屉，让用户立刻看到效果 */
  onChanged?: (on: boolean) => void;
}) {
  const { on, toggle } = useSimpleMode(initialOn);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        toggle();
        onChanged?.(!on);
      }}
      className={`flex w-full items-center gap-3 rounded-none text-left transition ${className}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-neutral-700">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-5 text-neutral-400">{hint}</span>}
      </span>
      {/* 开关只作视觉说明：状态语义由按钮的 aria-pressed 承担，所以整块 aria-hidden */}
      <span
        aria-hidden
        className={`relative h-5 w-9 shrink-0 rounded-none border transition ${
          on ? "border-brand-600 bg-brand-500" : "border-brand-200 bg-surface"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-none transition-transform ${
            on ? "translate-x-4 bg-white" : "translate-x-0 bg-neutral-400"
          }`}
        />
      </span>
    </button>
  );
}
