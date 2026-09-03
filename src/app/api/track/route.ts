import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";

// PV/IP 采集端：PageTracker 发 beacon，失败静默（统计不能影响页面）
export async function POST(req: NextRequest) {
 try {
 // 采集限流：每 IP 60 次 / 分钟（防刷量）
 if (!rateLimit(`track:${req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"}`, 60, 60_000))
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

 const now = new Date();
 const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
 now.getDate(),
 ).padStart(2, "0")}`;

 await prisma.visit.create({ data: { day, ipHash, path } });
 } catch {
 // 统计失败不影响访问
 }
 return new Response(null, { status: 204 });
}
