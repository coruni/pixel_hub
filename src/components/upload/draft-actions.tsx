"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { clearDraftsAction, deleteDraftAction } from "@/lib/actions/draft";
import { confirmDialog } from "@/components/ui/feedback";
import { Button } from "@/components/ui/Button";

/** 删除单条草稿（列表行内小按钮） */
export function DraftDelete({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      disabled={pending}
      aria-label="删除草稿"
      title="删除草稿"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = await confirmDialog({
          title: "删除草稿",
          message: "删除后本条草稿的内容无法恢复，确认删除？",
          confirmLabel: "删除",
          danger: true,
        });
        if (!ok) return;
        start(async () => {
          await deleteDraftAction(id);
          router.refresh();
        });
      }}
      className="shrink-0 rounded-none p-1.5 text-neutral-300 transition hover:text-red-500 disabled:opacity-50"
    >
      <Trash2 size={13} aria-hidden />
    </Button>
  );
}

/** 清空全部草稿 */
export function DraftsClearAll() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={async () => {
        const ok = await confirmDialog({
          title: "清空草稿箱",
          message: "确认删除全部草稿？未发布的内容将一并丢失。",
          confirmLabel: "清空",
          danger: true,
        });
        if (!ok) return;
        start(async () => {
          await clearDraftsAction();
          router.refresh();
        });
      }}
      variant="danger"
    >
      {pending ? "清理中…" : "清空全部"}
    </Button>
  );
}
