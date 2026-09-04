// 轻量内存限流（固定窗口滑动清理版）：单进程部署够用；多实例/生产可换 Redis。
// key 建议带维度前缀：`login:${ip}:${email}`、`comment:${userId}` 等。

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/** 命中返回 true（并记录）；超过 limit/periodMs 返回 false */
export function rateLimit(key: string, limit: number, periodMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < periodMs);
  if (b.hits.length >= limit) {
    buckets.set(key, b);
    return false;
  }
  b.hits.push(now);
  buckets.set(key, b);

  // 惰性清扫：每分钟清一次过期桶，防内存无限增长
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, v] of buckets) {
      if (v.hits.every((t) => now - t >= periodMs)) buckets.delete(k);
    }
  }
  return true;
}

/** 从请求头取客户端 IP（同 track route 的取法） */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : headers.get("x-real-ip")) ?? "unknown";
}
