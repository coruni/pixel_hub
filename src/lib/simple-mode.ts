// 「简洁模式」：访客侧的一键降噪 —— 把别人设的背景图整体收掉。
//
// 起因：个人主页 / 资源详情页 / 全站全局层那三类背景图由**作者**设置，遮罩形状也是作者选的，
// 部分组合下正文会被压得看不清。访客不该为此去联系作者，所以给一个自己的开关。
//
// 【为什么存 cookie，而不是像配色那样进账号字段】
//   配色走 User.colorMode 是为了「换设备也同步」；简洁模式是「我在这台设备上看不清」的应急开关，
//   未登录的访客也必须有 —— 账号字段做不到这一点。
//   cookie 的额外好处是服务端在 layout 里读得到，SSR 首帧就带上属性，**零闪烁**；
//   若改用 localStorage，只能在 hydration 之后补，会先闪一帧背景图再消失。
//
// 本模块只做「读写偏好」，开关的渲染效果收在 globals.css（把背景层 display:none），
// 不改任何数据、不涉及服务端权限。

/** 存偏好的 cookie 名。值：`"1"` = 开启，其余一律视为关闭 */
export const SIMPLE_BG_COOKIE = "ph_simple_bg";
/** 承载当前状态的 `<html>` 属性名：服务端按 cookie 写初值，客户端点击时改它 */
export const SIMPLE_BG_ATTR = "data-simple-bg";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** cookie 原始值 → 布尔（服务端 layout 与客户端共用同一口径） */
export function parseSimpleBg(v: string | null | undefined): boolean {
  return v === "1";
}

/** 把状态落到 DOM（属性存在即生效） */
export function applySimpleBg(on: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (on) root.setAttribute(SIMPLE_BG_ATTR, "1");
  else root.removeAttribute(SIMPLE_BG_ATTR);
}

/** 读当前生效状态 —— 以 `<html>` 上的属性为准，避免状态双份 */
export function readSimpleBg(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.hasAttribute(SIMPLE_BG_ATTR);
}

/** 写回 cookie。path=/ 必须显式给：默认值是被写页面所在目录，换到别的路径下就丢了 */
export function writeSimpleBgCookie(on: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SIMPLE_BG_COOKIE}=${on ? "1" : "0"}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}
