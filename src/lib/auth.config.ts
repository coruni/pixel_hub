import type { NextAuthConfig } from "next-auth";

/** 需要登录的前缀（middleware 门控用） */
export const PROTECTED_PREFIXES = ["/upload", "/settings", "/notifications", "/admin"];

/**
 * 边缘安全（edge-safe）配置：可被 middleware 导入。
 * 真正的 providers / adapter 在 lib/auth.ts 追加（node 运行时）。
 * 只做 token 变换，避免 Prisma 进 edge bundle。
 */
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // 站点经 CDN/反向代理前置：trustHost 让 Auth.js 从请求头（host / x-forwarded-proto /
  // x-forwarded-host）动态推导 baseUrl——回调地址恒等于用户实际访问的公网域名，
  // 无需在 .env 写死 AUTH_URL。登录与绑定共用 /api/auth/callback/github 一个回调
  //（GitHub OAuth App 只能登记一个），redirect_uri 与登记值一致才不报 mismatch。
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
      return isProtected ? !!auth?.user : true;
    },
    jwt({ token, user }) {
      if (user) {
        // 空 providers 泛型下 user/token 被推断过窄，做显式形状
        const u = user as unknown as {
          id?: string;
          username?: string;
          role?: "USER" | "MODERATOR" | "ADMIN";
          trusted?: boolean;
        };
        const tok = token as unknown as {
          id?: string;
          username?: string;
          role?: "USER" | "MODERATOR" | "ADMIN";
          trusted?: boolean;
        };
        tok.id = u.id;
        tok.username = u.username;
        if (u.role) tok.role = u.role;
        tok.trusted = u.trusted;
        return tok;
      }
      return token;
    },
    session({ session, token }) {
      const t = token as unknown as {
        id?: string;
        username?: string;
        role?: "USER" | "MODERATOR" | "ADMIN";
        trusted?: boolean;
      };
      // token 身份被清空（封禁/改密后的失效会话，见 lib/auth.ts 的 jwt 回查）→ 视为未登录
      if (!t.id) {
        session.user = undefined as never;
        return session;
      }
      if (session.user) {
        session.user.id = t.id;
        session.user.username = t.username ?? "";
        session.user.role = t.role ?? "USER";
        session.user.trusted = t.trusted ?? false;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
