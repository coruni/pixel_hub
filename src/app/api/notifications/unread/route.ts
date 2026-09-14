import { auth } from "@/lib/auth";
import { getUnreadNotificationCount } from "@/lib/notify";

// 顶部导航未读角标轮询用：只读、只返回自己的未读数。
// 未登录返回 0 而不是 401 —— 角标不是鉴权数据，静默降级更省事。
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = (await auth())?.user;
    if (!user) return Response.json({ unread: 0 });
    return Response.json({ unread: await getUnreadNotificationCount(user.id) });
  } catch {
    return Response.json({ unread: 0 });
  }
}
