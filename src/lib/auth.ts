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
            // 不允许 GitHub 邮箱自动并入已有站内账号（劫持他人凭邮箱抢登）；
            // 绑定走 settings 的手动 OAuth 流（startGitHubBindAction）
            allowDangerousEmailAccountLinking: false,
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
    // 覆盖 jwt 回调：登录瞬间写入身份（同 authConfig），此后每次请求回查 DB，
    // 让封禁 / 降权 / 取消免审 / 改密立即生效（strategy=jwt 下 session 表删除不生效）。
    // pw 为 passwordHash 尾部签名，改密/重置后旧 token 全部失效（含攻击者持有的旧会话）。
    async jwt({ token, user }) {
      const t = token as unknown as {
        id?: string;
        username?: string;
        role?: "USER" | "MODERATOR" | "ADMIN";
        trusted?: boolean;
        pw?: string;
      };
      if (user) {
        const u = user as unknown as {
          id?: string;
          username?: string;
          role?: "USER" | "MODERATOR" | "ADMIN";
          trusted?: boolean;
        };
        t.id = u.id;
        t.username = u.username;
        if (u.role) t.role = u.role;
        t.trusted = u.trusted;
      }
      if (t.id) {
        const row = await prisma.user.findUnique({
          where: { id: t.id },
          select: { role: true, trusted: true, bannedAt: true, passwordHash: true },
        });
        const sig = row?.passwordHash?.slice(-16) ?? "";
        if (!row || row.bannedAt || (t.pw !== undefined && t.pw !== sig)) {
          // 会话失效：清空身份，session 回调将得到未登录态
          delete t.id;
          delete t.username;
          delete t.role;
          delete t.trusted;
          delete t.pw;
        } else {
          t.role = row.role;
          t.trusted = row.trusted;
          t.pw = sig;
        }
      }
      return token;
    },
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
