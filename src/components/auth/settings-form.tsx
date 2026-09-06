"use client";

import { useActionState } from "react";
import { updateProfileAction, type SettingsActionState } from "@/lib/actions/settings";

const input =
  "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500";

export default function SettingsForm({ name, bio }: { name: string | null; bio: string | null }) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    updateProfileAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700" htmlFor="name">
          昵称
        </label>
        <input
          id="name"
          name="name"
          defaultValue={name ?? ""}
          maxLength={30}
          className={input}
          placeholder="显示名称，留空则用用户名"
        />
        {state.fieldErrors?.name && (
          <p className="mt-1 text-xs text-red-500">{state.fieldErrors.name[0]}</p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700" htmlFor="bio">
          个人简介
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={200}
          defaultValue={bio ?? ""}
          className={input}
          placeholder="介绍一下自己 / 创作方向…"
        />
        {state.fieldErrors?.bio && (
          <p className="mt-1 text-xs text-red-500">{state.fieldErrors.bio[0]}</p>
        )}
      </div>

      {state.ok && <p className="text-sm text-emerald-600">✓ 已保存</p>}
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-none border border-brand-600 bg-brand-500 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {pending ? "保存中…" : "保存"}
      </button>
    </form>
  );
}
