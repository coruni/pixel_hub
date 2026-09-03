import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";

// GitHub 绑定回调：code 换 token → 拿 GitHub 用户 id → 落 Account 行
export async function GET(req: NextRequest) {
  const back = (code: string) => NextResponse.redirect(new URL(`/settings?bind=${code}`, req.url));

  const session = (await auth())?.user;
  if (!session) return back("no-session");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("gh_bind_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) return back("state");

  const clientId = process.env.GITHUB_ID;
  const clientSecret = process.env.GITHUB_SECRET;
  if (!clientId || !clientSecret) return back("err");

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return back("token");

    const userRes = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${tokenJson.access_token}`, accept: "application/vnd.github+json" },
    });
    if (!userRes.ok) return back("github");
    const ghUser = (await userRes.json()) as { id?: number; login?: string };
    if (!ghUser.id) return back("github");

    const providerAccountId = String(ghUser.id);
    const existing = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: "github", providerAccountId } },
      select: { userId: true },
    });
    if (existing && existing.userId !== session.id) return back("taken");

    await prisma.account.upsert({
      where: { provider_providerAccountId: { provider: "github", providerAccountId } },
      create: { userId: session.id, type: "oauth", provider: "github", providerAccountId },
      update: { userId: session.id },
    });
    return back("ok");
  } catch (e) {
    console.error("[github-bind]", e);
    return back("err");
  }
}
