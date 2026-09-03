import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// 使用边缘安全的配置做门控（不含 adapter / Prisma）
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|seed|uploads).*)"],
};
