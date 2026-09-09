// 站点"当前请求"公开地址（服务端专用，勿在 client 组件导入）：
// 站点经 CDN/反向代理前置后，Host/X-Forwarded-* 头携带的就是用户实际访问的公网域名，
// 而 .env 的 SITE_URL/AUTH_URL 常缺省或与真实域名漂移——邮件链接、回调地址等
// "必须指向用户可达域名"的场景应优先取请求头，而非写死的环境变量。
// 头缺失或非请求上下文（定时任务等）时回退 siteUrl()（env 或 localhost）。
// 取值顺序与 Auth.js trustHost 的 baseUrl 推导保持一致：协议取 x-forwarded-proto，
// 域名取 x-forwarded-host，均取逗号分隔的第一项（CDN 追加自身时第一项为原始值）。
import { headers } from "next/headers";
import { siteUrl } from "@/lib/site-url";

export async function requestSiteUrl(): Promise<string> {
  try {
    const h = await headers();
    const proto = (h.get("x-forwarded-proto") ?? h.get("proto") ?? "http")
      .split(",")[0]
      .trim();
    const xForwardedHost = h.get("x-forwarded-host");
    const rawHost = (xForwardedHost ?? h.get("host") ?? "").split(",")[0].trim();
    if (!rawHost) return siteUrl();
    // 经 CDN/反代时，x-forwarded-host 常携带上游内部端口（如 :3000），
    // 该端口对用户不可达，应剥离；端口以 x-forwarded-port 为准（下方逻辑会剔除 80/443）。
    // 直连（开发/无反代）时保留 host 头自带端口（如 localhost:3000）。
    const hostWithoutPort = xForwardedHost
      ? rawHost.replace(/:\d+$/, "")
      : rawHost;
    const port = h.get("x-forwarded-port");
    const hostPart =
      port && port !== "80" && port !== "443" && !hostWithoutPort.includes(":")
        ? `${hostWithoutPort}:${port}`
        : hostWithoutPort;
    // 协议完全跟随转发头（x-forwarded-proto / proto）——站点 http、https 都可能，
    // 不假定协议；头缺失时回退 siteUrl()（env 或 localhost）。
    return `${proto}://${hostPart}`;
  } catch {
    // headers() 在非请求上下文（构建期/定时任务）会抛错 → 回退 env 基址
    return siteUrl();
  }
}
