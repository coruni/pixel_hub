"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { restoreResource, setResourceRemoved } from "@/lib/actions/moderation";

/** 直发抽查条目的操作：下架（通知作者）/ 恢复 */
export default function SpotActions({ resourceId }: { resourceId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) window.alert(r.error ?? "操作失败");
      else router.refresh();
    });

  const b =
    "rounded-none border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50";

  return (
    <div className="flex gap-2">
      <button
        disabled={pending}
        onClick={() => {
          if (window.confirm("确认下架该内容？作者会收到通知。")) act(() => setResourceRemoved(resourceId));
        }}
        className={`${b} border-red-300 text-red-500 hover:bg-red-50`}
      >
        下架
      </button>
      <button
        disabled={pending}
        onClick={() => act(() => restoreResource(resourceId))}
        className={`${b} border-brand-200 bg-surface text-neutral-600 hover:border-brand-500`}
      >
        恢复
      </button>
    </div>
  );
}
