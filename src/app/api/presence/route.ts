import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

// 在线状态心跳：登录用户每 60s 发一次（beacon），刷新 lastSeenAt。
// 判定窗口 ONLINE_WINDOW_MS 见 lib/online.ts（5 分钟）。
export async function POST() {
  try {
    const user = (await auth())?.user;
    if (user) await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
  } catch {
    // 心跳失败静默
  }
  return new Response(null, { status: 204 });
}
