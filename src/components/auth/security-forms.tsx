"use client";

import { useActionState } from "react";
import {
  changePasswordAction,
  changeEmailAction,
  type SettingsActionState,
} from "@/lib/actions/settings";
import { Button } from "@/components/ui/Button";

const input =
  "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500";

function FieldError({ msg }: { msg?: string[] }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs text-red-500">{msg[0]}</p>;
}

const submitBtn =
  "rounded-none border border-brand-600 bg-brand-500 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    changePasswordAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700" htmlFor="current">
          当前密码
        </label>
        <input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          className={input}
        />
        <FieldError msg={state.fieldErrors?.current} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700" htmlFor="next">
          新密码
        </label>
        <input
          id="next"
          name="next"
          type="password"
          autoComplete="new-password"
          className={input}
        />
        <FieldError msg={state.fieldErrors?.next} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700" htmlFor="confirm">
          确认新密码
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          className={input}
        />
        <FieldError msg={state.fieldErrors?.confirm} />
      </div>

      {state.ok && <p className="text-sm text-emerald-600">✓ 密码已更新</p>}
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}

      <Button type="submit" disabled={pending} className={submitBtn}>
        {pending ? "提交中…" : "修改密码"}
      </Button>
    </form>
  );
}

export function EmailForm({ currentEmail }: { currentEmail: string | null }) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    changeEmailAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700" htmlFor="email">
          新邮箱
        </label>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={currentEmail ?? ""}
          placeholder="新的登录邮箱"
          className={input}
        />
        <FieldError msg={state.fieldErrors?.email} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700" htmlFor="email-password">
          当前密码
        </label>
        <input
          id="email-password"
          name="password"
          type="password"
          autoComplete="current-password"
          className={input}
        />
        <FieldError msg={state.fieldErrors?.password} />
      </div>

      {state.ok && <p className="text-sm text-emerald-600">✓ 邮箱已更新</p>}
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}

      <Button type="submit" disabled={pending} className={submitBtn}>
        {pending ? "提交中…" : "修改邮箱"}
      </Button>
    </form>
  );
}
