// 集中式限流（H2 修复）：优先走 Postgres 共享存储，Vercel 多实例下计数一致，
// 登录/注册/密码重置/评论/关注等限流不再被分散到不同实例而失效。
// DB 不可用（含迁移尚未执行）时透明回退内存 Map，限流自身不成为故障点、且回退前行为不变。
// key 建议带维度前缀：`login:${ip}`、`comment:${userId}` 等。
import { prisma } from "@/lib/db/prisma";

type Bucket = { hits: number[] };
const memFallback = new Map<string, Bucket>();
let lastSweep = 0;

function memLimit(key: string, limit: number, periodMs: number): boolean {
  const now = Date.now();
  const b = memFallback.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < periodMs);
  if (b.hits.length >= limit) {
    memFallback.set(key, b);
    return false;
  }
  b.hits.push(now);
  memFallback.set(key, b);
  // 惰性清扫：每分钟清一次过期桶，防内存无限增长
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, v] of memFallback) {
      if (v.hits.every((t) => now - t >= periodMs)) memFallback.delete(k);
    }
  }
  return true;
}

/**
 * 命中返回 true（并记录）；超过 limit/periodMs 返回 false。
 * 走 Postgres：`DELETE` 过期窗口 → `COUNT` 当前窗口 → 未超限则 `INSERT`。
 * 注意非原子，极限并发下可能多放行 1~2 次，对限流场景可接受。
 */
export async function rateLimit(key: string, limit: number, periodMs: number): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - periodMs);
    await prisma.rateLimitHit.deleteMany({ where: { key, ts: { lt: cutoff } } });
    const count = await prisma.rateLimitHit.count({ where: { key } });
    if (count >= limit) return false;
    await prisma.rateLimitHit.create({ data: { key } });
    return true;
  } catch {
    // 表不存在 / DB 抖动：回退内存，避免限流本身阻断主流程（多实例下本回退不跨实例共享）
    return memLimit(key, limit, periodMs);
  }
}

/** 从请求头取客户端 IP（同 track route 的取法） */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : headers.get("x-real-ip")) ?? "unknown";
}
