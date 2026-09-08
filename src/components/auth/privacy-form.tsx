"use client";

// 主页隐私设置：收藏/粉丝/关注列表是否对外展示（本人始终可见）。
// SquareCheckbox 非受控模式（name + defaultChecked），随 FormData 直接提交。
import { useActionState } from "react";
import { updatePrivacyAction, type SettingsActionState } from "@/lib/actions/settings";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";

const ITEMS = [
  {
    name: "showFavorites",
    label: "展示收藏",
    hint: "公开后任何人都能在你的主页看到收藏列表与收藏夹分组",
  },
  {
    name: "showFollowers",
    label: "展示粉丝",
    hint: "关闭后主页不再显示「关注者」列表",
  },
  {
    name: "showFollowing",
    label: "展示关注",
    hint: "关闭后主页不再显示「关注中」列表",
  },
] as const;

export default function PrivacyForm({
  showFavorites,
  showFollowers,
  showFollowing,
}: {
  showFavorites: boolean;
  showFollowers: boolean;
  showFollowing: boolean;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    updatePrivacyAction,
    {},
  );
  const current: Record<string, boolean> = {
    showFavorites,
    showFollowers,
    showFollowing,
  };

  return (
    <form action={formAction} className="space-y-4">
      <ul className="space-y-3.5">
        {ITEMS.map((it) => (
          <li key={it.name} className="flex items-start gap-3">
            <SquareCheckbox
              name={it.name}
              defaultChecked={current[it.name]}
              ariaLabel={it.label}
              className="mt-0.5"
            />
            <div className="min-w-0">
              <p className="text-sm text-neutral-800">{it.label}</p>
              <p className="mt-0.5 text-xs leading-5 text-neutral-400">{it.hint}</p>
            </div>
          </li>
        ))}
      </ul>

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
