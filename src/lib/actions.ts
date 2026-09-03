"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { signIn, signOut } from "@/lib/auth";

// ---------- 登录 ----------

const loginFields = z.object({
  identifier: z.string().trim().min(1, "请输入邮箱或用户名"),
  password: z.string().min(1, "请输入密码"),
});
export type LoginState = { error?: string; fieldErrors?: { identifier?: string[]; password?: string[] } };

export async function loginAction(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const parsed = loginFields.safeParse({
    identifier: String(fd.get("identifier") ?? ""),
    password: String(fd.get("password") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const rawCb = String(fd.get("callbackUrl") ?? "/");
  const callbackUrl = rawCb.startsWith("/") && !rawCb.startsWith("//") ? rawCb : "/";
  try {
    await signIn("credentials", { identifier: parsed.data.identifier, password: parsed.data.password, redirectTo: callbackUrl });
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
  fieldErrors?: { email?: string[]; username?: string[]; password?: string[]; name?: string[] };
};

export async function registerAction(_prev: RegisterState, fd: FormData): Promise<RegisterState> {
  const parsed = registerFields.safeParse({
    email: String(fd.get("email") ?? ""),
    username: String(fd.get("username") ?? ""),
    name: String(fd.get("name") ?? "").trim() || undefined,
    password: String(fd.get("password") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const { email, username, name, password } = parsed.data;
  // 并发下仍可能有唯一键冲突，预检给出友好错误
  const [byEmail, byName] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { username } }),
  ]);
  if (byEmail) return { fieldErrors: { email: ["该邮箱已被注册"] } };
  if (byName) return { fieldErrors: { username: ["该用户名已被占用"] } };

  try {
    await prisma.user.create({
      data: {
        email,
        username,
        name: name || username,
        passwordHash: bcrypt.hashSync(password, 10),
        role: "USER",
        trusted: false,
      },
    });
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
