"use client";

import { useActionState, useState } from "react";
import { Lock } from "lucide-react";
import { updateNameColorAction } from "@/lib/actions/decorations";
import type { SettingsActionState } from "@/lib/actions/settings";
import { Button } from "@/components/ui/Button";

// 昵称特效色选择器。
//
// 每个选项**直接用该颜色渲染用户自己的昵称**，不再另画色块 —— 所见即所得，
// 选色时看到的正是主页/评论里的实际效果，也不用维护一份色块与文字色的对应关系。
//
// 门槛判定**不在这里**：服务端用 decorations.ts 的 decorationUnlocked() 算好 unlocked 传进来，
// 这里只负责显示与收集选择。锁定的项 disabled，但仍会随表单提交，服务端会再挡一次。

export type NameColorOption = {
  key: string;
  name: string;
  /** 文字色类名（字面量，见 decorations.ts） */
  className: string;
  unlocked: boolean;
  /** 锁定时的门槛等级名；null = 门槛指向不存在的档位 */
  needName: string | null;
};

export default function NameColorForm({
  options,
  current,
  sample,
  points,
}: {
  options: NameColorOption[];
  /** 当前生效的 key；null = 默认色 */
  current: string | null;
  /** 预览用的昵称文本：每个选项都用它渲染，好让用户看到自己的名字 */
  sample: string;
  points: number;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    updateNameColorAction,
    {},
  );
  const [picked, setPicked] = useState(current ?? "");

  const dirty = picked !== (current ?? "");
  const lockedCount = options.filter((o) => !o.unlocked).length;

  const cellCls = (active: boolean, unlocked: boolean) =>
    [
      "flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-none border px-2 py-2 text-center transition",
      active ? "border-brand-500 bg-brand-50" : "border-brand-200 bg-surface hover:border-brand-500",
      unlocked ? "" : "cursor-not-allowed hover:border-brand-200",
    ].join(" ");

  return (
    <form action={formAction} className="min-w-0">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {/* 「默认」始终可用：取消装饰不该有任何门槛 */}
        <label className={cellCls(picked === "", true)}>
          <input
            type="radio"
            name="nameColor"
            value=""
            checked={picked === ""}
            onChange={() => setPicked("")}
            className="sr-only"
          />
          <span className="max-w-full truncate text-sm font-medium text-neutral-800">{sample}</span>
          <span className="text-[10px] text-neutral-400">默认</span>
        </label>

        {options.map((o) => (
          <label key={o.key} className={cellCls(picked === o.key, o.unlocked)}>
            <input
              type="radio"
              name="nameColor"
              value={o.key}
              checked={picked === o.key}
              onChange={() => setPicked(o.key)}
              disabled={!o.unlocked}
              aria-label={`${o.name}色`}
              className="sr-only"
            />
            <span
              className={`max-w-full truncate text-sm font-medium ${o.className} ${
                o.unlocked ? "" : "opacity-55"
              }`}
            >
              {sample}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-neutral-400">
              {!o.unlocked && <Lock size={9} aria-hidden />}
              {o.unlocked ? o.name : o.needName ? `需「${o.needName}」` : "未开放"}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          disabled={pending || !dirty}
          className="rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存"}
        </Button>
        {state.ok && <span className="text-xs text-emerald-600">✓ 已更新</span>}
        {state.error && <span className="text-xs text-red-500">{state.error}</span>}
      </div>

      <p className="mt-1.5 text-[11px] leading-4 text-neutral-400">
        只改变昵称颜色，不影响等级徽章。当前贡献分 {points}
        {lockedCount > 0 ? ` · 还有 ${lockedCount} 款待等级解锁` : " · 已全部解锁"}。
      </p>
    </form>
  );
}
