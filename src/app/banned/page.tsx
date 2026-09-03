import Link from "next/link";
import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { logoutAction } from "@/lib/actions";

export const metadata: Metadata = { title: "账号已被封禁", robots: { index: false } };

export default async function BannedPage() {
  // 已登录的封禁用户能看到具体原因；从登录口拦下的（无 session）显示通用文案
  const session = await auth();
  let reason: string | null = null;
  let bannedAt: Date | null = null;
  if (session?.user?.id) {
    const row = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { bannedAt: true, bannedReason: true },
    });
    if (row?.bannedAt) {
      bannedAt = row.bannedAt;
      reason = row.bannedReason;
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-none border border-brand-200 bg-surface p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-none bg-red-50 text-red-500">
          <ShieldAlert size={26} aria-hidden />
        </span>
        <h1 className="mt-5 text-xl font-semibold text-neutral-900">账号已被封禁</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          {reason ? (
            <>
              封禁原因：<span className="text-neutral-800">{reason}</span>
            </>
          ) : (
            "该账号因违反社区规范被封禁，暂时无法登录与发布内容。"
          )}
        </p>
        {bannedAt && (
          <p className="mt-1 text-xs text-neutral-400">
            封禁时间：
            {new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(bannedAt)}
          </p>
        )}
        <p className="mt-4 text-xs leading-5 text-neutral-400">
          如认为有误，可联系管理员申诉（附上用户名与相关内容链接）。
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          {session?.user ? (
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-none border border-brand-600 bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                退出登录
              </button>
            </form>
          ) : (
            <Link
              href="/"
              className="rounded-none border border-brand-600 bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              返回首页
            </Link>
          )}
          <Link
            href="/"
            className="rounded-none border border-brand-200 px-4 py-2 text-sm text-neutral-600 hover:border-brand-500 hover:text-neutral-900"
          >
            浏览公开内容
          </Link>
        </div>
      </div>
    </div>
  );
}
