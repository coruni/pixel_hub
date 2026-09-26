import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/origin";
import { dayKey } from "@/lib/format";
import { hashIp, ipFromHeaders } from "@/lib/ip";

// PV/IP 采集端：PageTracker 发 beacon，失败静默（统计不能影响页面）
export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return new Response(null, { status: 204 });
    // IP 取值与哈希统一走 src/lib/ip.ts（与下载去重共用同一实现，避免两处哈希漂移）
    const ip = ipFromHeaders(req.headers);
    // 采集限流：每 IP 60 次 / 分钟（防刷量）
    // 修：原先限流 key 只取 x-forwarded-for（无则统一落 "local"），无代理部署下所有访客共用一个桶，
    // 60 次/分钟被瞬间打满后全体丢采集。改用统一取值（含 x-real-ip 回退）后每客户端独立计数。
    if (!(await rateLimit(`track:${ip}`, 60, 60_000))) return new Response(null, { status: 204 });
    const body = (await req.json().catch(() => null)) as { path?: unknown } | null;
    const path = typeof body?.path === "string" ? body.path.slice(0, 200) : "";
    if (!path.startsWith("/")) return new Response(null, { status: 204 });

    const ipHash = hashIp(ip);
    const day = dayKey(new Date());

    // 资源详情页浏览量与 PV 同链路采集（bumpView 无调用方，viewCount 从不增长的旧 bug）
    // updateMany：slug 不存在/未发布时静默不计数；同 IP 限流天然防刷
    const slug = path.match(/^\/resources\/([^/?#]+)/)?.[1];

    // 三条写入合并成一次事务 + 一次往返（原先是 create / bumpView / sweep 各自独立 await，
    // 远程库上等于把 PV 采集拖成 3 个 RTT，而这是每个页面浏览都走的路径）。
    // 事务内 ensure 语义不变：visit 失败整体失败、viewCount 也不加，与旧行为一致。
    const sweep = Math.random() < 0.01;
    const cutoffDay = sweep ? dayKey(new Date(Date.now() - 180 * 24 * 3600 * 1000)) : null;

    await prisma.$transaction(async (tx) => {
      await tx.visit.create({ data: { day, ipHash, path } });
      if (slug) {
        await tx.resource.updateMany({
          where: { slug: decodeURIComponent(slug), status: "PUBLISHED" },
          data: { viewCount: { increment: 1 } },
        });
      }
      // 访问明细保留 180 天：约 1% 的请求顺带清理过期行（机会式保留，免去定时任务；
      // 按 day 前缀比较可命中索引，YYYY-MM-DD 字典序即时间序）
      if (cutoffDay) await tx.visit.deleteMany({ where: { day: { lt: cutoffDay } } });
    });
  } catch {
    // 统计失败不影响访问
  }
  return new Response(null, { status: 204 });
}
