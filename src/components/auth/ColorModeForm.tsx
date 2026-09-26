"use client";

// 配色偏好：跟随系统 / 浅色 / 深色。
//
// 选中即刷 <html>（当场看到效果）——配色是「看一眼才知道喜不喜欢」的东西，
// 要用户先保存再去看等于让人反复来回。点「保存」才写进账号：不保存就离开也不留痕，
// 下次渲染时 layout 会按账号值把 class 重新纠正回来。
// 游客没有账号，看不到这个区块（设置页本身需要登录），一律跟随浏览器配色。
import { useActionState, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { updateColorModeAction, type SettingsActionState } from "@/lib/actions/settings";
import { applyColorMode, type ColorMode } from "@/lib/color-mode";
import { Button } from "@/components/ui/Button";

// 图标承担「一眼分辨」，文字承担语义 —— 不靠颜色区分，也不用 emoji 顶替图标
const OPTIONS: { value: ColorMode; label: string; note: string; Icon: typeof Sun }[] = [
  {
    value: "system",
    label: "跟随系统",
    note: "随操作系统/浏览器的深浅色走，系统切换时自动同步",
    Icon: Monitor,
  },
  { value: "light", label: "浅色", note: "始终使用暖白浅色主题", Icon: Sun },
  { value: "dark", label: "深色", note: "始终使用暖黑深色主题", Icon: Moon },
];

export default function ColorModeForm({ mode }: { mode: ColorMode }) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    updateColorModeAction,
    {},
  );
  const [picked, setPicked] = useState<ColorMode>(mode);

  return (
    <form action={formAction} className="space-y-4">
      <fieldset className="min-w-0">
        <legend className="sr-only">配色模式</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {OPTIONS.map((o) => (
            <label key={o.value} className="relative block cursor-pointer">
              <input
                type="radio"
                name="colorMode"
                value={o.value}
                checked={picked === o.value}
                onChange={() => {
                  setPicked(o.value);
                  applyColorMode(o.value);
                }}
                className="peer sr-only"
              />
              <span className="flex min-h-11 flex-col justify-center gap-0.5 rounded-none border border-brand-200 bg-surface px-3 py-2 transition peer-hover:border-brand-400 peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-900">
                  <o.Icon size={13} aria-hidden />
                  {o.label}
                </span>
                <span className="text-[11px] leading-4 text-neutral-500">{o.note}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-xs leading-5 text-neutral-400">
        选择后会立刻预览效果，点「保存」才写入账号（登录其他设备同样生效）。
      </p>

      {state.ok && <p className="text-sm text-emerald-600">✓ 已保存</p>}
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}

      <Button type="submit" disabled={pending} variant="primary" size="md">
        {pending ? "保存中…" : "保存"}
      </Button>
    </form>
  );
}
