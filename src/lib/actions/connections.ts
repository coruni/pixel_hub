"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

// ---- GitHub 账号绑定（手动 OAuth 流，独立于 NextAuth 登录）----

const BIND_CALLBACK = "/api/auth/bind/github/callback";

export async function startGitHubBindAction(): Promise<void> {
  const user = (await auth())?.user;
  if (!user) redirect("/login?callbackUrl=/settings");

  const clientId = process.env.GITHUB_ID;
  if (!clientId) redirect("/settings?bind=err");

  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("gh_bind_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: BIND_CALLBACK,
  });

  // 回调地址需要绝对 URL：优先 AUTH_URL，否则从请求头拼
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = process.env.AUTH_URL?.replace(/\/$/, "") ?? `${proto}://${host}`;

  const url =
    `https://github.com/login/oauth/authorize?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${base}${BIND_CALLBACK}`,
      state,
      scope: "read:user",
    });

  redirect(url);
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
