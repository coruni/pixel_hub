import type { NextRequest } from "next/server";

/**
 * 写路由的 CSRF 纵深防御：跨站浏览器请求（form/fetch/beacon）必带 Origin 头，
 * 校验其与 Host 同源；不带 Origin 的客户端（curl、服务端调用）放行——
 * 跨站 cookie 攻击场景浏览器一定会带 Origin，Auth.js 会话 cookie 的 SameSite=Lax 已是第一道防线。
 */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}
