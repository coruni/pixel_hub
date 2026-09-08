"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { registerAction } from "@/lib/actions";
import { sendRegisterCodeAction } from "@/lib/actions/register-code";

const inputCls =
  "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

export default function RegisterForm({ codeRequired }: { codeRequired: boolean }) {
  const [state, formAction, pending] = useActionState(registerAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [codeState, setCodeState] = useState<{ ok?: boolean; error?: string }>({});
  const [sending, startSend] = useTransition();
  const [cooldown, setCooldown] = useState(0);

  // 发送成功后 60 秒倒计时，期间禁止重发（与服务端单邮箱限流对齐）
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = () => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    startSend(async () => {
      const r = await sendRegisterCodeAction({}, fd);
      setCodeState(r);
      if (r.ok) setCooldown(60);
    });
  };

  return (
    <div className="w-full max-w-md">
      <div className="rounded-none border border-brand-200 bg-surface p-8">
        <h1 className="text-xl font-semibold text-neutral-900">创建账号</h1>
        <p className="mt-1 text-sm text-neutral-500">加入社区</p>

        {state.error && (
          <p className="mt-4 rounded-none bg-red-50 px-3 py-2 text-sm text-red-600">
            {state.error}
          </p>
        )}

        <form ref={formRef} action={formAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-neutral-700">
              邮箱
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

          {codeRequired && (
            <div>
              <label
                htmlFor="reg-code"
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
                邮箱验证码
              </label>
              <div className="flex gap-2">
                <input
                  id="reg-code"
                  name="code"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  className={`${inputCls} flex-1 tracking-[0.3em]`}
                  placeholder="6 位数字"
                  autoComplete="one-time-code"
                />
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={sending || cooldown > 0}
                  className="shrink-0 rounded-none border border-brand-600 bg-surface px-3 py-2.5 text-xs text-neutral-700 transition hover:bg-brand-50 disabled:opacity-50"
                >
                  {sending
                    ? "发送中…"
                    : cooldown > 0
                      ? `${cooldown}s 后重发`
                      : "发送验证码"}
                </button>
              </div>
              {codeState.ok && (
                <p className="mt-1 text-xs text-emerald-600" role="status">
                  验证码已发送，请查收邮箱（注意垃圾箱），10 分钟内有效。
                </p>
              )}
              {codeState.error && (
                <p className="mt-1 text-xs text-red-500" role="alert">
                  {codeState.error}
                </p>
              )}
              {state.fieldErrors?.code && (
                <p className="mt-1 text-xs text-red-500">{state.fieldErrors.code[0]}</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="username"
                className="mb-1.5 block text-sm font-medium text-neutral-700"
              >
                用户名
              </label>
              <input
                id="username"
                name="username"
                required
                className={inputCls}
                placeholder="英文，用于主页"
              />
              {state.fieldErrors?.username && (
                <p className="mt-1 text-xs text-red-500">{state.fieldErrors.username[0]}</p>
              )}
            </div>
            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-neutral-700">
                昵称
              </label>
              <input id="name" name="name" className={inputCls} placeholder="显示名（可选）" />
            </div>
          </div>
          <div>
            <label
              htmlFor="reg-password"
              className="mb-1.5 block text-sm font-medium text-neutral-700"
            >
              密码
            </label>
            <input
              id="reg-password"
              name="password"
              type="password"
              autoComplete="new-password"
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
            {pending ? "创建中…" : "注册并登录"}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-neutral-500">
        已有账号？{" "}
        <Link href="/login" className="font-medium text-neutral-900 hover:underline">
          去登录
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-neutral-400">
        新用户投稿需审核（白名单作者免审直发）。
      </p>
    </div>
  );
}
