import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/origin";
import { dayKey } from "@/lib/format";

// PV/IP 采集端：PageTracker 发 beacon，失败静默（统计不能影响页面）
export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return new Response(null, { status: 204 });
    // 采集限流：每 IP 60 次 / 分钟（防刷量）
    if (
      !(await rateLimit(
        `track:${req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`,
        60,
        60_000,
      ))
    )
      return new Response(null, { status: 204 });
    const body = (await req.json().catch(() => null)) as { path?: unknown } | null;
    const path = typeof body?.path === "string" ? body.path.slice(0, 200) : "";
    if (!path.startsWith("/")) return new Response(null, { status: 204 });

    // 反向代理后真实 IP 在 x-forwarded-for 首段；本地开发无代理时用占位
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "local";
    // 加盐哈希：不落明文 IP，AUTH_SECRET 作盐
    const ipHash = createHash("sha256")
      .update(ip + (process.env.AUTH_SECRET ?? ""))
      .digest("hex")
      .slice(0, 16);

    const day = dayKey(new Date());

    await prisma.visit.create({ data: { day, ipHash, path } });

    // 访问明细保留 180 天：约 1% 的请求顺带清理过期行（机会式保留，免去定时任务；
    // 按 day 前缀比较可命中索引，YYYY-MM-DD 字典序即时间序）
    if (Math.random() < 0.01) {
      const cutoffDay = dayKey(new Date(Date.now() - 180 * 24 * 3600 * 1000));
      void prisma.visit.deleteMany({ where: { day: { lt: cutoffDay } } }).catch(() => {});
    }

    // 资源详情页浏览量与 PV 同链路采集（bumpView 无调用方，viewCount 从不增长的旧 bug）
    // updateMany：slug 不存在/未发布时静默不计数；同 IP 限流天然防刷
    const slug = path.match(/^\/resources\/([^/?#]+)/)?.[1];
    if (slug) {
      void prisma.resource
        .updateMany({
          where: { slug: decodeURIComponent(slug), status: "PUBLISHED" },
          data: { viewCount: { increment: 1 } },
        })
        .catch(() => {});
    }
  } catch {
    // 统计失败不影响访问
  }
  return new Response(null, { status: 204 });
}
