"use client";

// 图片水印：开关 + 自定义文字，默认关闭。
// 与隐私设置同一形态（勾选 + 保存按钮）：这里带输入框，即时保存会导致「字打一半就生效」，
// 所以统一由「保存」提交。勾选框同时受控（用于联动输入框的禁用态）并带 name（随 FormData 提交）。
import { useActionState, useState } from "react";
import { updateWatermarkAction, type SettingsActionState } from "@/lib/actions/settings";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import { Button } from "@/components/ui/Button";
import { WATERMARK_TEXT_MAX } from "@/lib/upload-config";

export default function WatermarkForm({
  enabled,
  text,
  username,
}: {
  enabled: boolean;
  text: string | null;
  username: string;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    updateWatermarkAction,
    {},
  );
  const [on, setOn] = useState(enabled);
  const fallback = `@${username}`;

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex items-start gap-3">
        <SquareCheckbox
          name="watermarkImages"
          checked={on}
          onChange={setOn}
          ariaLabel="给上传的图片加水印"
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="block text-sm text-neutral-800">给上传的图片加水印</span>
          <span className="mt-0.5 block text-xs leading-5 text-neutral-400">
            开启后，新上传的图集与评论附图会在右下角押上水印文字，原图同样带印。已上传的图片不会被重新处理。
          </span>
        </span>
      </label>

      <div>
        <label htmlFor="watermarkText" className="block text-sm text-neutral-800">
          水印文字
        </label>
        <p className="mt-0.5 text-xs leading-5 text-neutral-400">留空则押 {fallback}</p>
        <input
          id="watermarkText"
          name="watermarkText"
          type="text"
          maxLength={WATERMARK_TEXT_MAX}
          defaultValue={text ?? ""}
          disabled={!on}
          placeholder={fallback}
          className="mt-2 w-full rounded-none border border-brand-200 bg-surface px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus-visible:border-brand-500 focus-visible:outline-none disabled:opacity-50"
        />
        {state.fieldErrors?.watermarkText && (
          <p className="mt-1 text-xs text-red-500">{state.fieldErrors.watermarkText[0]}</p>
        )}
      </div>

      {state.ok && <p className="text-sm text-emerald-600">✓ 已保存</p>}
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}

      <Button
        type="submit"
        disabled={pending}
        className="rounded-none border border-brand-600 bg-brand-500 px-6 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {pending ? "保存中…" : "保存"}
      </Button>
    </form>
  );
}
