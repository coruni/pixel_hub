"use client";

import { Moon, Sun } from "lucide-react";

// 明暗切换：class 策略（<html class="dark">），记忆在 localStorage("theme")。
// 首帧由 layout 内联脚本设置；图标用 dark: 变体跟随 <html> class 渲染，
// 无组件状态（无水合闪烁，也避免 effect 里 setState）。
export default function ThemeToggle() {
  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="切换明暗模式"
      title="切换明暗模式"
      className="grid h-8 w-8 place-items-center rounded-none border border-brand-200 bg-surface text-neutral-600 transition hover:border-brand-500 hover:text-neutral-900"
    >
      <Sun size={15} className="hidden dark:inline" aria-hidden />
      <Moon size={15} className="dark:hidden" aria-hidden />
    </button>
  );
}
