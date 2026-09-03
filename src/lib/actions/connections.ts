"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";
import { auth, signIn } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

// ---- GitHub 账号绑定 ----
// 复用 GitHub 登录的 OAuth 回调 /api/auth/callback/github（GitHub OAuth App 只能配一个
// callback URL）。Auth.js 核心在「已登录 + OAuth 授权」时自动 linkAccount——把 GitHub
// 账号挂到当前用户而不切换会话；账号已被他人绑定时抛 AccountNotLinked。
// 所以绑定 = 已登录状态下走一遍 GitHub OAuth。

export async function startGitHubBindAction(): Promise<void> {
  const user = (await auth())?.user;
  if (!user) redirect("/login?callbackUrl=/settings");
  if (!process.env.GITHUB_ID || !process.env.GITHUB_SECRET) redirect("/settings?bind=err");

  try {
    // 授权后回到 /api/auth/callback/github：绑定完成，跳回设置页
    await signIn("github", { redirectTo: "/settings?bind=ok" });
  } catch (error) {
    // signIn 正常流程抛 redirect（不是错误）；AuthError 才是真失败。
    // AccountNotLinked = 该 GitHub 账号已绑其他用户，其余按通用失败处理
    if (error instanceof AuthError) {
      const name = (error as { code?: string }).code ?? error.name;
      redirect(name === "OAuthAccountNotLinked" || name === "AccountNotLinked" ? "/settings?bind=taken" : "/settings?bind=err");
    }
    throw error;
  }
}

export async function unbindGitHubAction(): Promise<void> {
  const user = (await auth())?.user;
  if (!user) return;

  // 解绑前提：还剩密码登录方式，否则解绑后账号无法进入
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, _count: { select: { accounts: true } } },
  });
  if (!row) return;
  if (!row.passwordHash && row._count.accounts <= 1) {
    redirect("/settings?bind=no-password");
  }

  await prisma.account.deleteMany({ where: { userId: user.id, provider: "github" } });
  revalidatePath("/settings");
}
