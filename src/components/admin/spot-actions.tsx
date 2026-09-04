"use client";

import { restoreResource, setResourceRemoved } from "@/lib/actions/moderation";
import { useAction } from "@/lib/hooks";

/** 直发抽查条目的操作：下架（通知作者）/ 恢复 */
export default function SpotActions({ resourceId }: { resourceId: string }) {
  const { run, pending } = useAction();

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm("确认下架该内容？作者会收到通知。"))
            run(() => setResourceRemoved(resourceId));
        }}
        className="rounded-none border border-red-300 px-3 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50"
      >
        下架
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => restoreResource(resourceId))}
        className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:border-brand-500 disabled:opacity-50"
      >
        恢复
      </button>
    </div>
  );
}
