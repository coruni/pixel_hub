import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Next.js 16 门控约定：middleware 已更名为 proxy（见 node_modules/next/dist/docs proxy.md）。
// 使用边缘安全的配置做门控（不含 adapter / Prisma）；只匹配需要登录的前缀（与
// auth.config 的 PROTECTED_PREFIXES 保持一致，matcher 必须是静态字面量），
// 其余路径不经过本层（server action 一律在自身内部校验权限，不依赖此门控）。
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/upload/:path*", "/settings/:path*", "/notifications/:path*", "/admin/:path*"],
};
