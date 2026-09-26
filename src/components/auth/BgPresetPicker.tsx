"use client";

import { useActionState, useState } from "react";
import { Check, Lock } from "lucide-react";
import { selectBgPresetAction } from "@/lib/actions/decorations";
import type { SettingsActionState } from "@/lib/actions/settings";
import { Button } from "@/components/ui/Button";

// 官方背景库选择器。
//
// 缩略图直接铺真实素材（cover），不另做一套小图 —— 底图本身是几何像素图案，
// 缩小后观感与铺满视口时一致，没必要维护两份资源。
//
// 与「自己上传背景」**互斥**：选中预设保存后会清掉自传图，所以有自传图时额外提示一句，
// 不让用户在不知情的情况下丢掉已上传的图。

export type BgPresetOption = {
  id: string;
  name: string;
  /** public 下的静态路径 */
  url: string;
  unlocked: boolean;
  needName: string | null;
};

export default function BgPresetPicker({
  options,
  current,
  hasUploaded,
}: {
  options: BgPresetOption[];
  /** 当前生效的预设 id；null = 未使用官方背景 */
  current: string | null;
  /** 用户是否已上传过自定义背景（互斥提示用） */
  hasUploaded: boolean;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    selectBgPresetAction,
    {},
  );
  const [picked, setPicked] = useState(current ?? "");

  const dirty = picked !== (current ?? "");
  const willDropUpload = Boolean(picked) && hasUploaded && picked !== (current ?? "");
  const lockedCount = options.filter((o) => !o.unlocked).length;

  const frameCls = (active: boolean, unlocked: boolean) =>
    [
      "group block w-full rounded-none border p-1.5 text-left transition",
      active ? "border-brand-500 bg-brand-50" : "border-brand-200 bg-surface",
      unlocked ? "cursor-pointer hover:border-brand-500" : "cursor-not-allowed opacity-60",
    ].join(" ");

  return (
    <form action={formAction} className="min-w-0">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* 「不使用」：取消装饰永远无门槛 */}
        <button
          type="button"
          onClick={() => setPicked("")}
          aria-pressed={picked === ""}
          className={frameCls(picked === "", true)}
        >
          <span className="grid aspect-[16/9] w-full place-items-center border border-dashed border-brand-200 text-[11px] text-neutral-400">
            不使用
          </span>
          <span className="mt-1.5 block truncate px-0.5 text-xs text-neutral-600">无背景</span>
        </button>

        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => o.unlocked && setPicked(o.id)}
            disabled={!o.unlocked}
            aria-pressed={picked === o.id}
            className={frameCls(picked === o.id, o.unlocked)}
          >
            <span className="relative block aspect-[16/9] w-full overflow-hidden border border-brand-200">
              <span
                className="block h-full w-full bg-cover bg-center bg-no-repeat"
                style={{ backgroundImage: `url(${o.url})` }}
                aria-hidden
              />
              {picked === o.id && (
                <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center bg-brand-500 text-white">
                  <Check size={11} aria-hidden />
                </span>
              )}
            </span>
            <span className="mt-1.5 flex items-center gap-1 px-0.5 text-xs text-neutral-600">
              {!o.unlocked && <Lock size={10} aria-hidden />}
              <span className="truncate">{o.name}</span>
              {!o.unlocked && (
                <span className="ml-auto shrink-0 text-[10px] text-neutral-400">
                  {o.needName ? `需「${o.needName}」` : "未开放"}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      <input type="hidden" name="preset" value={picked} />

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

      {willDropUpload && (
        <p className="mt-1.5 text-[11px] leading-4 text-amber-600">
          保存后会删除你上传的自定义背景图（两者只能留一个）。
        </p>
      )}
      <p className="mt-1.5 text-[11px] leading-4 text-neutral-400">
        与下面的自定义上传二选一。仅桌面端展示，铺满视口最底层
        {lockedCount > 0 ? ` · 还有 ${lockedCount} 款待等级解锁` : " · 已全部解锁"}。
      </p>
    </form>
  );
}
