// 集中式限流（H2 修复）：优先走 Postgres 共享存储，多进程/多实例部署下计数一致、
// 且重启不清零；登录/注册/密码重置/评论/关注等限流不会因为换进程而失效。
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
 *
 * 走 Postgres 的**单次往返**实现（原先 DELETE → COUNT → INSERT 是 3 次网络往返，
 * 在远程库上单次限流检查就要吃掉几十毫秒，而评论、登录、下载每条路径都挂着一个）。
 *
 * 语义与旧实现等价：删掉窗口外的旧命中，再数窗口内的条数，未超限则插入。
 * 用 CTE 把三步串成一条语句 —— Postgres 保证 CTE 内各子语句看到的是**同一快照**，
 * 所以 COUNT 数的是「清理前」的行数（含已过期的那些）。
 *
 * ⚠️ 因此 COUNT 的谓词必须自己再写一遍 `ts >= cutoff`，不能图省事只数全表：
 * 旧实现的 DELETE 先落地、COUNT 后执行，读到的自然是已清理的行；
 * 单语句版本里三者并发，只数全表会把过期行算进配额，等价于限流被历史流量撑大而失效。
 *
 * 仍然非原子（并发下可能多放行 1~2 次），与旧实现口径一致，对限流场景可接受。
 */
export async function rateLimit(key: string, limit: number, periodMs: number): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - periodMs);
    const rows = await prisma.$queryRaw<{ allowed: boolean }[]>`
      WITH purged AS (
        DELETE FROM "RateLimitHit" WHERE "key" = ${key} AND "ts" < ${cutoff}
      ), counted AS (
        SELECT count(*)::int AS n FROM "RateLimitHit"
        WHERE "key" = ${key} AND "ts" >= ${cutoff}
      ), inserted AS (
        INSERT INTO "RateLimitHit" ("id", "key", "ts")
        SELECT gen_random_uuid()::text, ${key}, now()
        FROM counted WHERE counted.n < ${limit}
        RETURNING 1
      )
      SELECT EXISTS (SELECT 1 FROM inserted) AS allowed
    `;
    // 查询本身没报错才算成功；没命中不可用路径时返回 false（未放行）
    return rows[0]?.allowed ?? false;
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
