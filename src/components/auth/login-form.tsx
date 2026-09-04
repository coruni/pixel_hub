"use client";

import Link from "next/link";
import { useActionState } from "react";
import { githubLoginAction, loginAction } from "@/lib/actions";

const inputCls =
  "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

export default function LoginForm({
  githubEnabled,
  callbackUrl = "/",
}: {
  githubEnabled: boolean;
  callbackUrl?: string;
}) {
  const [state, formAction, pending] = useActionState(loginAction, {});
  const [ghError, ghAction] = useActionState(
    async () => (await githubLoginAction()) ?? null,
    null as string | null,
  );

  return (
    <div className="w-full max-w-md">
      <div className="rounded-none border border-brand-200 bg-surface p-8">
        <h1 className="text-xl font-semibold text-neutral-900">登录</h1>
        <p className="mt-1 text-sm text-neutral-500">欢迎回来，继续发现和分享资源</p>

        {state.error && (
          <p className="mt-4 rounded-none bg-red-50 px-3 py-2 text-sm text-red-600">
            {state.error}
          </p>
        )}
        {ghError && (
          <p className="mt-4 rounded-none bg-red-50 px-3 py-2 text-sm text-red-600">{ghError}</p>
        )}

        <form action={formAction} className="mt-6 space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div>
            <label
              htmlFor="identifier"
              className="mb-1.5 block text-sm font-medium text-neutral-700"
            >
              邮箱或用户名
            </label>
            <input
              id="identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              required
              className={inputCls}
              placeholder="you@example.com 或用户名"
            />
            {state.fieldErrors?.identifier && (
              <p className="mt-1 text-xs text-red-500">{state.fieldErrors.identifier[0]}</p>
            )}
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-neutral-700">
              密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputCls}
              placeholder="••••••••"
            />
            {state.fieldErrors?.password && (
              <p className="mt-1 text-xs text-red-500">{state.fieldErrors.password[0]}</p>
            )}
          </div>
          {/* 密码找回入口 */}
          <div className="text-right">
            <Link
              href="/forgot-password"
              className="text-xs text-neutral-400 hover:text-neutral-900"
            >
              忘记密码？
            </Link>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-none border border-brand-600 bg-brand-500 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
          >
            {pending ? "登录中…" : "登录"}
          </button>
        </form>

        {githubEnabled && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-neutral-400">
              <span className="h-px flex-1 bg-neutral-200" />或
              <span className="h-px flex-1 bg-neutral-200" />
            </div>
            <form action={ghAction}>
              <button
                type="submit"
                className="w-full rounded-none border border-brand-200 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-brand-50"
              >
                GitHub 登录
              </button>
            </form>
          </>
        )}
      </div>

      <p className="mt-4 text-center text-sm text-neutral-500">
        还没有账号？{" "}
        <Link href="/register" className="font-medium text-neutral-900 hover:underline">
          立即注册
        </Link>
      </p>
      {import.meta.env.DEV && (
        <div className="mt-4 rounded-none border-2 border-dashed border-brand-300 bg-brand-50/40 px-4 py-3 text-xs leading-5 text-neutral-500">
          演示账号（密码均 <code className="rounded-none bg-neutral-200 px-1">test1234</code>）：
          <span className="ml-1">
            <code>admin</code>（管理员·免审） / <code>creator</code>（可信创作者·免审） /{" "}
            <code>demo</code>（普通用户，投稿需审核）
          </span>
        </div>
      )}
    </div>
  );
}
