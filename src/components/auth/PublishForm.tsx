"use client";

// 发布偏好：草稿自动保存开关。
// 勾选即生效（onChange 直接落库），不额外要点保存——单一开关用即时保存更符合直觉。
import { useState, useTransition } from "react";
import { setAutoSaveDraftAction } from "@/lib/actions/draft";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";

export default function PublishForm({
  autoSaveDraft,
  draftCount,
}: {
  autoSaveDraft: boolean;
  draftCount: number;
}) {
  const [on, setOn] = useState(autoSaveDraft);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(next: boolean) {
    setOn(next);
    setSaved(false);
    setError(null);
    start(async () => {
      const r = await setAutoSaveDraftAction(next);
      if (r.ok) setSaved(true);
      else setError("保存失败，请重试");
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3">
        <SquareCheckbox
          checked={on}
          onChange={toggle}
          disabled={pending}
          ariaLabel="自动保存草稿"
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="block text-sm text-neutral-800">自动保存草稿</span>
          <span className="mt-0.5 block text-xs leading-5 text-neutral-400">
            开启后编辑内容时每 30 秒自动留存一次草稿（停手时立刻存），误删或中断也能接着写；
            关闭则只在点「保存草稿」或按 Ctrl+S 时留档。发布向导里不再提供这个开关。
          </span>
        </span>
      </label>

      {saved && <p className="text-sm text-emerald-600">✓ 已保存</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      <p className="text-xs text-neutral-400">
        当前有 {draftCount} 条草稿，可在下方「草稿箱」里继续编辑或删除。
      </p>
    </div>
  );
}
