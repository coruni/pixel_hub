// 站点"当前请求"公开地址（服务端专用，勿在 client 组件导入）：
// 站点经 CDN/反向代理前置后，Host/X-Forwarded-* 头携带的就是用户实际访问的公网域名，
// 而 .env 的 SITE_URL/AUTH_URL 常缺省或与真实域名漂移——邮件链接、回调地址等
// "必须指向用户可达域名"的场景应优先取请求头，而非写死的环境变量。
// 头缺失或非请求上下文（定时任务等）时回退 siteUrl()（env 或 localhost）。
// 取值顺序与 Auth.js trustHost 的 baseUrl 推导保持一致：协议取 x-forwarded-proto，
// 域名取 x-forwarded-host，均取逗号分隔的第一项（CDN 追加自身时第一项为原始值）。
//
// 【端口策略：经代理的公网地址一律不带端口】
// 反代 / 容器会把**上游内部端口**塞进转发头（如 `X-Forwarded-Host: site.com:3000`、
// `X-Forwarded-Port: 3000`，宝塔 nginx、Caddy、Cloudflare Tunnel 都可能这么写）。
// 邮件是发给**远端收件人**的，浏览器打开 `https://site.com:3000/...` 必然连不上 ——
// 这正是邮件模板里链接带端口的来源：先前"剥掉 host 的端口、再按 x-forwarded-port 补回"
// 的写法把同一个内部端口又装了回去。公网域名下端口只可能是 80/443，且协议由
// x-forwarded-proto 表达，故只要出现任何转发头（= 经代理）就一律剥离。
// 两个例外保留端口：① **回环地址**（本地 next dev 跑在 :3000，剥掉后预览链接点不开，
// 同机反代还会把端口挪进 x-forwarded-port）；② **完全没有转发头痕迹的直连** ——
// 此时 host 头就是用户地址栏里的地址，端口是他自己敲的。
import { headers } from "next/headers";
import { siteUrl } from "@/lib/site-url";

/** 推导 origin 所需的请求头（纯数据，便于探针/单测断言） */
export type OriginHeaders = {
  xForwardedProto?: string | null;
  /** 少数反代（如 Auth.js 生态）写的是裸 `proto` */
  proto?: string | null;
  xForwardedHost?: string | null;
  host?: string | null;
  xForwardedPort?: string | null;
  /** 仅用于判断"是否经代理"（代理一定会写转发头） */
  xForwardedFor?: string | null;
  xRealIp?: string | null;
};

/** 回环地址：本地开发 / 同机反代，这类主机保留端口 */
const LOOPBACK_HOST = /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\]|::1)$/i;

const firstValue = (v?: string | null) => (v ?? "").split(",")[0].trim();

/**
 * 由转发头推导站点公开 origin（纯函数，唯一实现）。
 * 顺序：协议取 x-forwarded-proto → proto → http；域名取 x-forwarded-host → host。
 * 端口只在「回环主机」或「完全没有转发头痕迹的直连」上保留（见文件头「端口策略」），返回值不带结尾斜杠。
 */
export function originFromHeaders(h: OriginHeaders, fallback: string): string {
  const proto = firstValue(h.xForwardedProto) || firstValue(h.proto) || "http";
  // x-forwarded-host 存在时以它为准：它才是用户实际访问的域名
  const xForwardedHost = firstValue(h.xForwardedHost);
  const rawHost = xForwardedHost || firstValue(h.host);
  if (!rawHost) return fallback;

  // 先无条件剥端口：host 头里的端口可能是上游内部端口（CDN/反代场景），
  // 公网域名下不存在"合法的非默认端口"这种情形。
  const hostname = rawHost.replace(/:\d+$/, "");
  // endsWith(":") 兜住无中括号的 IPv6 字面量（"::1" 会被上面的正则啃掉尾巴）
  if (!hostname || hostname.endsWith(":")) return fallback;

  // 有没有反代痕迹：任一转接头出现即视为经代理（代理必然写其中至少一个）。
  const proxied = !!(
    xForwardedHost ||
    firstValue(h.xForwardedProto) ||
    firstValue(h.proto) ||
    firstValue(h.xForwardedPort) ||
    firstValue(h.xForwardedFor) ||
    firstValue(h.xRealIp)
  );
  const hostPort = rawHost.slice(hostname.length).replace(/^:/, "");
  // 回环主机：本地 next dev 在 :3000，端口必须留（否则预览链接点不开），
  // 本地反代还可能把端口挪进 x-forwarded-port。
  // 无任何转发头的直连：host 头就是用户地址栏里的地址，端口是他自己敲的，同样保留。
  // 其余（经代理的公网主机）：端口必定不可信，一律丢。
  const port = LOOPBACK_HOST.test(hostname)
    ? hostPort || firstValue(h.xForwardedPort)
    : proxied
      ? ""
      : hostPort;
  const hostPart = port && port !== "80" && port !== "443" ? `${hostname}:${port}` : hostname;

  return `${proto}://${hostPart}`;
}

export async function requestSiteUrl(): Promise<string> {
  // 非请求上下文（构建期/定时任务）回退 env 基址
  const fallback = siteUrl();
  try {
    const h = await headers();
    return originFromHeaders(
      {
        xForwardedProto: h.get("x-forwarded-proto"),
        proto: h.get("proto"),
        xForwardedHost: h.get("x-forwarded-host"),
        host: h.get("host"),
        xForwardedPort: h.get("x-forwarded-port"),
        // 只用于判断"是否经代理"（代理必然写转发头 ⇒ 其 host 端口不可信）
        xForwardedFor: h.get("x-forwarded-for"),
        xRealIp: h.get("x-real-ip"),
      },
      fallback,
    );
  } catch {
    return fallback;
  }
}
