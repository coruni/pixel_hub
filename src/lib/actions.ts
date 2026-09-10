"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { signIn, signOut } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { emailCodeRequired, verifyRegisterCode } from "@/lib/register-code";

// ---------- 登录 ----------

const loginFields = z.object({
  identifier: z.string().trim().min(1, "请输入邮箱或用户名"),
  password: z.string().min(1, "请输入密码"),
});
export type LoginState = {
  error?: string;
  fieldErrors?: { identifier?: string[]; password?: string[] };
};

export async function loginAction(_prev: LoginState, fd: FormData): Promise<LoginState> {
  // 登录限流：每 IP 10 次 / 5 分钟（防爆破）
  const ip = clientIp(await headers());
  if (!(await rateLimit(`login:${ip}`, 10, 5 * 60_000))) return { error: "尝试次数过多，请 5 分钟后再试" };
  const parsed = loginFields.safeParse({
    identifier: String(fd.get("identifier") ?? ""),
    password: String(fd.get("password") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const rawCb = String(fd.get("callbackUrl") ?? "/");
  const callbackUrl = rawCb.startsWith("/") && !rawCb.startsWith("//") ? rawCb : "/";
  try {
    // 封禁用户在密码校验前先行拦截，引导到封禁提示页（带原因）
    const id = parsed.data.identifier;
    const u = id.includes("@")
      ? await prisma.user.findUnique({
          where: { email: id.toLowerCase() },
          select: { bannedAt: true },
        })
      : await prisma.user.findUnique({ where: { username: id }, select: { bannedAt: true } });
    if (u?.bannedAt) redirect("/banned");
    await signIn("credentials", {
      identifier: parsed.data.identifier,
      password: parsed.data.password,
      redirectTo: callbackUrl,
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) return { error: "邮箱/用户名或密码不正确，或账号已被封禁" };
    throw error; // 成功登录的 redirect 异常放行
  }
}

// ---------- 注册 ----------

const registerFields = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{3,20}$/, "用户名仅限字母/数字/下划线，3-20 位"),
  name: z.string().trim().max(24, "昵称过长").optional(),
  password: z.string().min(8, "密码至少 8 位").max(72, "密码过长"),
});
export type RegisterState = {
  error?: string;
  fieldErrors?: {
    email?: string[];
    username?: string[];
    password?: string[];
    name?: string[];
    code?: string[];
  };
};

export async function registerAction(_prev: RegisterState, fd: FormData): Promise<RegisterState> {
  // 注册限流：每 IP 5 次 / 小时（防批量小号）
  const ip = clientIp(await headers());
  if (!(await rateLimit(`register:${ip}`, 5, 60 * 60_000))) return { error: "注册过于频繁，请稍后再试" };
  const parsed = registerFields.safeParse({
    email: String(fd.get("email") ?? ""),
    username: String(fd.get("username") ?? ""),
    name: String(fd.get("name") ?? "").trim() || undefined,
    password: String(fd.get("password") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const { email, username, name, password } = parsed.data;

  // 邮箱验证码校验（后台开启 + SMTP 可用时启用；见 register-code.ts）
  if (await emailCodeRequired()) {
    const code = String(fd.get("code") ?? "").trim();
    if (!/^\d{6}$/.test(code)) return { fieldErrors: { code: ["请输入 6 位邮箱验证码"] } };
    const v = await verifyRegisterCode(email, code);
    if (!v.ok) {
      const msg =
        v.reason === "expired"
          ? "验证码已过期，请重新获取"
          : v.reason === "attempts"
            ? "错误次数过多，请重新获取验证码"
            : "验证码不正确";
      return { fieldErrors: { code: [msg] } };
    }
  }

  // 并发下仍可能有唯一键冲突，预检给出友好错误
  const [byEmail, byName] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { username } }),
  ]);
  if (byEmail) return { fieldErrors: { email: ["该邮箱已被注册"] } };
  if (byName) return { fieldErrors: { username: ["该用户名已被占用"] } };

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    // 部署即开站：库中尚无任何 ADMIN 时，首个注册者自动成为管理员（可事务串行化防并发双管理员）
    await prisma.$transaction(
      async (tx) => {
        const hasAdmin = (await tx.user.count({ where: { role: "ADMIN" } })) > 0;
        await tx.user.create({
          data: {
            email,
            username,
            name: name || username,
            passwordHash,
            role: hasAdmin ? "USER" : "ADMIN",
            trusted: !hasAdmin, // 首任管理员直发免审
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
    // 注册成功自动登录
    await signIn("credentials", { identifier: email, password, redirectTo: "/" });
    return {};
  } catch (error) {
    if (error instanceof AuthError) return { error: "注册后自动登录失败，请前往登录页" };
    throw error;
  }
}

// ---------- GitHub / 退出 ----------

export async function githubLoginAction(): Promise<string | void> {
  try {
    await signIn("github", { redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) return "GitHub 登录失败，请稍后再试";
    throw error;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}
