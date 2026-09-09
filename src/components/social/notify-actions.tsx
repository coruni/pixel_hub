"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { clearNotificationsAction, deleteNotificationAction } from "@/lib/actions/notify";
import { confirmDialog } from "@/components/ui/feedback";
import { Button } from "@/components/ui/Button";

const b = "rounded-none px-3 py-1.5 text-xs font-medium transition disabled:opacity-50";

/** 单条删除（列表项内小按钮） */
export function NotificationDelete({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      disabled={pending}
      aria-label="删除通知"
      title="删除"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start(async () => {
          await deleteNotificationAction(id);
          router.refresh();
        });
      }}
      className="shrink-0 rounded-none p-1.5 text-neutral-300 transition hover:text-red-500 disabled:opacity-50"
    >
      <Trash2 size={13} aria-hidden />
    </Button>
  );
}

/** 清空全部 */
export function NotificationsClearAll() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={async () => {
        const ok = await confirmDialog({
          title: "清空通知",
          message: "确认清空全部通知？",
          confirmLabel: "清空",
          danger: true,
        });
        if (!ok) return;
        start(async () => {
          await clearNotificationsAction();
          router.refresh();
        });
      }}
      className={`${b} border border-red-200 text-red-500 hover:border-red-400 hover:bg-red-50`}
    >
      {pending ? "清理中…" : "清空全部"}
    </Button>
  );
}
