"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction } from "@/lib/actions/password-reset";
import { Button } from "@/components/ui/Button";

const inputCls =
  "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

export default function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, {});

  return (
    <div className="w-full max-w-md">
      <div className="rounded-none border border-brand-200 bg-surface p-8">
        <h1 className="text-xl font-semibold text-neutral-900">找回密码</h1>
        <p className="mt-1 text-sm text-neutral-500">
          输入注册邮箱，我们会发送重置链接（30 分钟内有效）
        </p>

        {state.error && (
          <p className="mt-4 rounded-none bg-red-50 px-3 py-2 text-sm text-red-600">
            {state.error}
          </p>
        )}

        {state.ok ? (
          <div className="mt-6">
            <p className="rounded-none bg-brand-50 px-3 py-2 text-sm text-neutral-700">
              如果该邮箱已注册，重置邮件已发出，请查收（注意垃圾箱）。
            </p>
            {/* SMTP 未配置的开发环境：直接给出链接便于联调 */}
            {state.previewLink && (
              <div className="mt-3 rounded-none border-2 border-dashed border-brand-300 bg-brand-50/40 px-3 py-2.5 text-xs leading-5 text-neutral-600">
                开发环境（SMTP 未配置）重置链接：
                <a
                  href={state.previewLink}
                  className="mt-1 block break-all font-medium text-brand-600 hover:underline"
                >
                  {state.previewLink}
                </a>
              </div>
            )}
          </div>
        ) : (
          <form action={formAction} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-neutral-700">
                注册邮箱
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className={inputCls}
                placeholder="you@example.com"
              />
              {state.fieldErrors?.email && (
                <p className="mt-1 text-xs text-red-500">{state.fieldErrors.email[0]}</p>
              )}
            </div>
            <Button
              type="submit"
              disabled={pending}
              className="w-full rounded-none border border-brand-600 bg-brand-500 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
            >
              {pending ? "发送中…" : "发送重置邮件"}
            </Button>
          </form>
        )}
      </div>

      <p className="mt-4 text-center text-sm text-neutral-500">
        想起密码了？{" "}
        <Link href="/login" className="font-medium text-neutral-900 hover:underline">
          返回登录
        </Link>
      </p>
    </div>
  );
}
