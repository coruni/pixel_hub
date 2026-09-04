import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getProfile } from "@/lib/queries";
import SettingsForm from "@/components/auth/settings-form";
import AvatarForm from "@/components/auth/avatar-form";
import { EmailForm, PasswordForm } from "@/components/auth/security-forms";
import { startGitHubBindAction, unbindGitHubAction } from "@/lib/actions/connections";

export const metadata: Metadata = { title: "账户设置", robots: { index: false } };

const BIND_MESSAGES: Record<string, string> = {
  ok: "GitHub 账号绑定成功",
  taken: "该 GitHub 账号已绑定其他用户",
  state: "绑定请求已过期，请重试",
  token: "GitHub 授权失败，请重试",
  github: "获取 GitHub 用户信息失败",
  "no-session": "登录状态失效，请重新登录",
  "no-password": "该账号未设置密码，无法解绑最后一个登录方式",
  err: "绑定失败，请稍后再试",
};

const roleLabel: Record<string, string> = {
  ADMIN: "管理员",
  MODERATOR: "版主",
  USER: "普通用户",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ bind?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/settings");

  const { bind } = await searchParams;
  const bindMsg = bind ? (BIND_MESSAGES[bind] ?? null) : null;

  const me = session.user;
  const profile = await getProfile(me.username, me.id);
  const githubAccount = await prisma.account.findFirst({
    where: { userId: me.id, provider: "github" },
    select: { providerAccountId: true },
  });
  const githubEnabled = Boolean(process.env.GITHUB_ID && process.env.GITHUB_SECRET);
  const joined = profile
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(
        profile.createdAt,
      )
    : null;

  const info: { k: string; v: string }[] = [
    { k: "用户名", v: `@${me.username}` },
    { k: "邮箱", v: me.email ?? "未绑定" },
    { k: "角色", v: roleLabel[me.role] ?? me.role },
    ...(joined ? [{ k: "加入时间", v: joined }] : []),
  ];

  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      {bindMsg && (
        <p
          className={`mb-4 rounded-none border px-3 py-2 text-xs ${
            bind === "ok"
              ? "border-brand-600 bg-brand-50 text-neutral-800"
              : "border-red-300 bg-red-50 text-red-600"
          }`}
        >
          {bindMsg}
        </p>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">账户设置</h1>
          <p className="mt-1 text-sm text-neutral-500">@{me.username}</p>
        </div>
        <Link
          href={`/u/${me.username}`}
          className="inline-flex items-center gap-1 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900"
        >
          查看公开主页 <ArrowUpRight size={12} aria-hidden />
        </Link>
      </div>

      {/* 头像 */}
      <section className="mt-6 rounded-none border border-brand-200 bg-surface p-6">
        <h2 className="text-sm font-semibold text-neutral-800">头像</h2>
        <p className="mb-4 mt-1 text-xs text-neutral-400">展示在个人主页、评论区与作者信息</p>
        <AvatarForm
          name={profile?.name ?? null}
          username={me.username}
          avatarKey={profile?.avatarKey ?? null}
          trusted={!!me.trusted}
        />
      </section>

      {/* 个人资料 */}
      <section className="mt-6 rounded-none border border-brand-200 bg-surface p-6">
        <h2 className="text-sm font-semibold text-neutral-800">个人资料</h2>
        <p className="mb-4 mt-1 text-xs text-neutral-400">昵称与简介会展示在你的公开主页</p>
        <SettingsForm name={profile?.name ?? null} bio={profile?.bio ?? null} />
      </section>

      {/* 账号信息（只读） */}
      <section className="mt-4 rounded-none border border-brand-200 bg-surface p-6">
        <h2 className="text-sm font-semibold text-neutral-800">账号信息</h2>
        <dl className="mt-4 space-y-2.5">
          {info.map((row) => (
            <div key={row.k} className="flex items-baseline justify-between gap-4 text-sm">
              <dt className="shrink-0 text-xs text-neutral-400">{row.k}</dt>
              <dd className="min-w-0 truncate text-neutral-800">{row.v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 账号安全：改密码 */}
      <section className="mt-4 rounded-none border border-brand-200 bg-surface p-6">
        <h2 className="text-sm font-semibold text-neutral-800">修改密码</h2>
        <p className="mb-4 mt-1 text-xs text-neutral-400">修改后其他设备需用新密码重新登录</p>
        <PasswordForm />
      </section>

      {/* 账号安全：换邮箱 */}
      <section className="mt-4 rounded-none border border-brand-200 bg-surface p-6">
        <h2 className="text-sm font-semibold text-neutral-800">登录邮箱</h2>
        <p className="mb-4 mt-1 text-xs text-neutral-400">修改需验证当前密码</p>
        <EmailForm currentEmail={me.email ?? null} />
      </section>

      {/* 第三方账号绑定 */}
      <section className="mt-4 rounded-none border border-brand-200 bg-surface p-6">
        <h2 className="text-sm font-semibold text-neutral-800">第三方账号</h2>
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-neutral-800">GitHub</p>
            <p className="mt-0.5 text-xs text-neutral-400">
              {githubAccount
                ? "已绑定，可直接使用 GitHub 登录本账号"
                : githubEnabled
                  ? "未绑定"
                  : "站点未开启 GitHub 登录"}
            </p>
          </div>
          {githubEnabled &&
            (githubAccount ? (
              <form action={unbindGitHubAction}>
                <button
                  type="submit"
                  className="rounded-none border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:border-red-400 hover:bg-red-50"
                >
                  解绑
                </button>
              </form>
            ) : (
              <form action={startGitHubBindAction}>
                <button
                  type="submit"
                  className="rounded-none border border-brand-200 px-3 py-1.5 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900"
                >
                  绑定 GitHub
                </button>
              </form>
            ))}
        </div>
      </section>
    </div>
  );
}
