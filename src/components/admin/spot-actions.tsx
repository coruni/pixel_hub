"use client";

import { restoreResource, setResourceRemoved } from "@/lib/actions/moderation";
import { useAction } from "@/lib/hooks";
import { confirmDialog } from "@/components/ui/feedback";
import { Button } from "@/components/ui/Button";

/** 直发抽查条目的操作：下架（通知作者）/ 恢复 */
export default function SpotActions({ resourceId }: { resourceId: string }) {
  const { run, pending } = useAction();

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={async () => {
          const ok = await confirmDialog({
            title: "下架内容",
            message: "确认下架该内容？作者会收到通知。",
            confirmLabel: "下架",
            danger: true,
          });
          if (ok) run(() => setResourceRemoved(resourceId));
        }}
        className="rounded-none border border-red-300 px-3 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "处理中…" : "下架"}
      </Button>
      <Button
        type="button"
        disabled={pending}
        onClick={() => run(() => restoreResource(resourceId))}
        className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:border-brand-500 disabled:opacity-50"
      >
        {pending ? "处理中…" : "恢复"}
      </Button>
    </div>
  );
}
