import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { redirect } from "next/navigation";
import { authConfig } from "./auth.config";
import { prisma } from "./db/prisma";

const credentialSchema = z.object({
  identifier: z.string().trim().min(1, "请输入邮箱或用户名"),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    // GitHub OAuth 仅在配置了 env 时启用
    ...(process.env.GITHUB_ID && process.env.GITHUB_SECRET
      ? [
          GitHub({
            clientId: process.env.GITHUB_ID,
            clientSecret: process.env.GITHUB_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    Credentials({
      name: "password",
      credentials: { identifier: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialSchema.safeParse(raw);
        if (!parsed.success) return null;
        // 支持「用户名或邮箱」登录：含 @ 视为邮箱（不区分大小写），否则按用户名精确匹配
        const identifier = parsed.data.identifier;
        const user = identifier.includes("@")
          ? await prisma.user.findUnique({ where: { email: identifier.toLowerCase() } })
          : await prisma.user.findUnique({ where: { username: identifier } });
        if (!user?.passwordHash) return null;
        if (user.bannedAt) return null; // 封禁用户禁止密码登录
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.username,
          username: user.username,
          role: user.role,
          trusted: user.trusted,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // 封禁用户在登录关口统一拦截（credentials + OAuth），引导到提示页
    // GitHub 绑定不需要专门逻辑：Auth.js 核心在「已登录 + OAuth」时自动 linkAccount
    //（绑定到当前用户而不切换会话）；账号已被他人绑定时抛 AccountNotLinked。
    async signIn({ user }) {
      if (!user?.id) return true;
      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { bannedAt: true },
      });
      if (row?.bannedAt) redirect("/banned");
      return true;
    },
  },
});
