// 客户端 IP 与「主体标识」—— IP 加盐哈希的**唯一实现**（服务端专用，勿在 client 组件引用 crypto）。
//
// 为什么必须收口：访问统计（Visit.ipHash）与下载去重（DownloadRecord.ipHash）必须能互相关联，
// 两处各写一份哈希实现迟早会漂移（改了盐、改了截断长度、改了取值顺序），
// 而漂移不会报错，只会让「同一 IP 的两张表对不上」这个隐性问题在排查时才暴露。
import { createHash } from "crypto";

/**
 * 取客户端 IP。口径与既有 `api/track` 完全一致：
 * 反向代理后真实 IP 在 `x-forwarded-for` 首段 → 回退 `x-real-ip` → 本地开发无代理时占位 "local"。
 *
 * ⚠️ 可信度取决于部署环境是否**覆盖**（而非追加）`x-forwarded-for`。
 * Vercel 会覆盖，可信；若前面自建反代/CDN，必须确认是覆盖，否则防刷闸门一可被伪造绕过。
 */
export function ipFromHeaders(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "local"
  );
}

/** 加盐哈希：不落明文 IP，`AUTH_SECRET` 作盐，取前 16 位十六进制 */
export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(ip + (process.env.AUTH_SECRET ?? ""))
    .digest("hex")
    .slice(0, 16);
}

/** 一步取到请求的 ipHash */
export function hashIpFromHeaders(headers: Headers): string {
  return hashIp(ipFromHeaders(headers));
}

/**
 * 下载计分的「主体标识」：
 * - 已登录 → `u:<userId>`：换 IP 也刷不出第二次
 * - 匿名   → `ip:<ipHash>`：同一出口 IP 只算一次（NAT 下会少算，偏差方向可接受）
 */
export function subjectKeyFor(userId: string | null | undefined, ipHash: string): string {
  return userId ? `u:${userId}` : `ip:${ipHash}`;
}
