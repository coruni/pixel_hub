"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// 明暗切换：class 策略（<html class="dark">），选择记忆在 localStorage("theme")。
// 首帧由 layout 内联脚本设置，这里挂载后读真实状态，避免 SSR/CSR 不一致。
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setReady(true);
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "切换到亮色模式" : "切换到暗色模式"}
      title={dark ? "切换到亮色模式" : "切换到暗色模式"}
      className="grid h-8 w-8 place-items-center rounded-none border border-brand-200 bg-surface text-neutral-600 transition hover:border-brand-500 hover:text-neutral-900"
    >
      {/* ready 前渲染占位形状，防止首帧图标闪跳 */}
      {ready ? dark ? <Sun size={15} /> : <Moon size={15} /> : <Moon size={15} className="opacity-0" />}
    </button>
  );
}
