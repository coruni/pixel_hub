// 配色偏好：system（跟随系统/浏览器）| light | dark。
//
// 事实来源按登录态二分，刻意不合并成一套：
//   · 已登录 —— 账号上的 User.colorMode，由 layout 服务端渲染进 <html data-color-mode>，跨设备同步；
//   · 游客   —— 没有账号可存，一律跟随浏览器 prefers-color-scheme。
// 因此本模块**不读写 localStorage**：老版本写下的 "theme" 键不再被采用，
// 否则会留下一个「跟系统对着干、游客又再也改不掉」的陈旧值。
//
// 首帧防闪由 app/layout.tsx 的内联脚本负责（它拿不到本模块，只能手写同样逻辑）；
// 这里提供运行时的读、写与系统联动。

export const COLOR_MODES = ["system", "light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

/** 承载当前偏好的 `<html>` 属性名：服务端写初值，客户端改它 */
export const COLOR_MODE_ATTR = "data-color-mode";

/** 库里的枚举（大写）→ 前端取值；未知/缺失一律回落到 system */
export function fromDbColorMode(v: string | null | undefined): ColorMode {
  const s = (v ?? "").toLowerCase();
  return (COLOR_MODES as readonly string[]).includes(s) ? (s as ColorMode) : "system";
}

/** 前端取值 → 库里的枚举 */
export function toDbColorMode(v: ColorMode): "SYSTEM" | "LIGHT" | "DARK" {
  return v === "light" ? "LIGHT" : v === "dark" ? "DARK" : "SYSTEM";
}

/** 系统/浏览器当前是否偏好深色 */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 给定偏好下最终要不要渲染成深色 */
export function resolveDark(mode: ColorMode): boolean {
  return mode === "dark" || (mode === "system" && systemPrefersDark());
}

/** 读当前生效的偏好 —— 以 `<html>` 上的属性为准，避免状态双份 */
export function readColorMode(): ColorMode {
  if (typeof document === "undefined") return "system";
  return fromDbColorMode(document.documentElement.getAttribute(COLOR_MODE_ATTR));
}

/**
 * 把偏好落到 DOM：属性记「偏好」，class 记「最终结果」，两者不可混为一谈
 * —— 跟随系统时属性仍是 system，深色与否由系统决定。
 * colorScheme 一并同步，让滚动条、下拉、表单控件这些原生 UI 也跟着变。
 */
export function applyColorMode(mode: ColorMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const dark = resolveDark(mode);
  root.setAttribute(COLOR_MODE_ATTR, mode);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

/** 订阅系统配色变化，返回取消订阅函数（无 matchMedia 的环境返回空实现） */
export function watchSystemColorMode(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
