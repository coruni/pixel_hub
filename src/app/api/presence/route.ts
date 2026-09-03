import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/origin";

// 在线状态心跳：登录用户每 60s 发一次（beacon），刷新 lastSeenAt。
// 判定窗口 ONLINE_WINDOW_MS 见 lib/online.ts（5 分钟）。
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return new Response(null, { status: 204 }); // 心跳非关键，静默拒绝即可
  try {
    const user = (await auth())?.user;
    // 客户端约定 60s 一次；放宽到 20/min 防高频心跳刷写
    if (user && rateLimit(`presence:${user.id}`, 20, 60_000))
      await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
  } catch {
    // 心跳失败静默
  }
  return new Response(null, { status: 204 });
}
