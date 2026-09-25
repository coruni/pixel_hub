import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * WebSocket 握手期的身份解析端点（仅供 server.js 回环调用）。
 *
 * server.js 是纯 JS 引导文件，拿不到 NextAuth 的会话解密能力；与其在那边重复实现 cookie
 * 名称与 JWE 解密，不如带着客户端的 Cookie 头走一次 127.0.0.1 回环请求复用 auth()。
 *
 * 只返回调用方自己的身份，不泄露任何他人数据，因此不需要同源校验；
 * 真正的防护在 upgrade 阶段的 Origin 校验（见 server.js 的 sameOriginUpgrade）与
 * Auth.js 会话 cookie 的 SameSite 上。
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = (await auth())?.user;
    if (!user?.id) return Response.json({ userId: null });
    // 与 requiredUser() 同口径：封禁账号不给实时身份，避免旧会话继续收通知
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { bannedAt: true },
    });
    if (!row || row.bannedAt) return Response.json({ userId: null });
    return Response.json({ userId: user.id });
  } catch {
    return Response.json({ userId: null });
  }
}
