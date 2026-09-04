"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPasswordAction } from "@/lib/actions/password-reset";

const inputCls =
  "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, {});

  return (
    <div className="w-full max-w-md">
      <div className="rounded-none border border-brand-200 bg-surface p-8">
        <h1 className="text-xl font-semibold text-neutral-900">设置新密码</h1>
        <p className="mt-1 text-sm text-neutral-500">重置成功后所有已登录设备将被踢下线</p>

        {state.error && <p className="mt-4 rounded-none bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>}

        <form action={formAction} className="mt-6 space-y-4">
          <input type="hidden" name="token" value={token} />
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-neutral-700">新密码</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className={inputCls}
              placeholder="至少 8 位"
            />
            {state.fieldErrors?.password && (
              <p className="mt-1 text-xs text-red-500">{state.fieldErrors.password[0]}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-none border border-brand-600 bg-brand-500 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
          >
            {pending ? "提交中…" : "重置密码"}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-neutral-500">
        <Link href="/login" className="font-medium text-neutral-900 hover:underline">
          返回登录
        </Link>
      </p>
    </div>
  );
}
