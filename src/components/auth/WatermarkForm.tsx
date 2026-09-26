"use client";

// 图片水印：开关 + 自定义文字 + 落点，默认关闭。
// 与隐私设置同一形态（勾选 + 保存按钮）：这里带输入框，即时保存会导致「字打一半就生效」，
// 所以统一由「保存」提交。勾选框同时受控（用于联动输入框与落点的禁用态）并带 name（随 FormData 提交）。
//
// 落点用原生 radio（name=watermarkPosition）：天然有单选分组语义与方向键切换，比一排 button
// 少一堆手写的 aria。每项配一张缩略示意图 —— 「左上」到底是哪个角，看一眼比读四个字快。
import { useActionState, useState } from "react";
import { updateWatermarkAction, type SettingsActionState } from "@/lib/actions/settings";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import { Button } from "@/components/ui/Button";
import {
  WATERMARK_POSITIONS,
  WATERMARK_TEXT_MAX,
  type WatermarkPositionValue,
} from "@/lib/upload-config";

const LABELS: Record<WatermarkPositionValue, string> = {
  TOP_LEFT: "左上",
  TOP_RIGHT: "右上",
  BOTTOM_LEFT: "左下",
  BOTTOM_RIGHT: "右下",
  TILE: "全屏斜铺",
};

const MARK_BOX = "relative block h-8 w-11 shrink-0 overflow-hidden border border-brand-300 bg-surface";

/** 落点示意图：一块「底图」+ 标记。四角画一段贴边的横杠，全屏斜铺画三条斜线 */
function PositionMark({ value }: { value: WatermarkPositionValue }) {
  if (value === "TILE") {
    // 三条斜线各自横跨整个示意框（left:-25% + w:150% 让旋转中心落在框中心）
    const bar = "absolute left-[-25%] h-[3px] w-[150%] rotate-[-25deg]";
    return (
      <span className={MARK_BOX} aria-hidden>
        <span className={`${bar} top-1 bg-brand-300`} />
        <span className={`${bar} top-1/2 bg-brand-500`} />
        <span className={`${bar} bottom-1 bg-brand-300`} />
      </span>
    );
  }

  const corner: Record<Exclude<WatermarkPositionValue, "TILE">, string> = {
    TOP_LEFT: "left-1.5 top-1.5",
    TOP_RIGHT: "right-1.5 top-1.5",
    BOTTOM_LEFT: "left-1.5 bottom-1.5",
    BOTTOM_RIGHT: "right-1.5 bottom-1.5",
  };
  return (
    <span className={MARK_BOX} aria-hidden>
      <span className={`absolute h-[3px] w-[36%] bg-brand-500 ${corner[value]}`} />
    </span>
  );
}

export default function WatermarkForm({
  enabled,
  text,
  position,
  username,
}: {
  enabled: boolean;
  text: string | null;
  position: WatermarkPositionValue;
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

      <fieldset className="min-w-0">
        <legend className="block text-sm text-neutral-800">水印位置</legend>
        <p className="mt-0.5 text-xs leading-5 text-neutral-400">
          全屏斜铺会以低透明度铺满整张图，适合容易被裁掉角落的搬运场景
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {WATERMARK_POSITIONS.map((p) => (
            <label key={p} className="relative block cursor-pointer">
              <input
                type="radio"
                name="watermarkPosition"
                value={p}
                defaultChecked={p === position}
                disabled={!on}
                className="peer sr-only"
              />
              <span
                className={`flex min-h-11 items-center gap-2 rounded-none border border-brand-200 bg-surface px-2.5 py-2 transition peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400 ${
                  on ? "peer-hover:border-brand-400" : "cursor-not-allowed opacity-50"
                }`}
              >
                <PositionMark value={p} />
                <span className="min-w-0 text-xs font-medium text-neutral-800">{LABELS[p]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.ok && <p className="text-sm text-emerald-600">✓ 已保存</p>}
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}

      <Button type="submit" disabled={pending} variant="primary" size="md">
        {pending ? "保存中…" : "保存"}
      </Button>
    </form>
  );
}
