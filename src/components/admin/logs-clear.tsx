"use client";

// 清空操作日志入口（仅管理员渲染，是否显示由调用方决定）。
// 清空范围＝当前筛选命中的记录，即「所见即所删」：未设筛选时才是清空全部。
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { confirmDialog, toast } from "@/components/ui/feedback";
import { useAction } from "@/lib/hooks";
import { clearAuditLogsAction } from "@/lib/actions/logs";

import { Button } from "@/components/ui/Button";

export default function ClearLogsButton({
  action,
  adminId,
  matched,
  href,
}: {
  /** 当前动作筛选值（空=不限），与页面查询同源 */
  action: string;
  /** 当前操作人筛选值（空=不限） */
  adminId: string;
  /** 当前筛选命中的条数 */
  matched: number;
  /** 保持筛选、回到第 1 页的地址（清空后当前页可能已越界） */
  href: string;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const filtered = !!action || !!adminId;

  const onClick = async () => {
    const ok = await confirmDialog({
      title: filtered ? "清空筛选结果" : "清空全部操作日志",
      message: filtered
        ? `将永久删除当前筛选命中的 ${matched} 条日志，不可恢复。\n清空动作本身会记入一条日志；如需清空全部，请先「清空筛选」。`
        : `将永久删除全部 ${matched} 条操作日志，不可恢复。\n清空动作本身会记入一条日志。`,
      confirmLabel: "清空",
      danger: true,
    });
    if (!ok) return;
    run(async () => {
      const res = await clearAuditLogsAction({ action, adminId });
      if (res.ok) {
        toast(`已清空 ${res.removed ?? 0} 条日志`, "success");
        router.replace(href);
      }
      return res;
    });
  };

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={pending || matched === 0}
      variant="danger"
    >
      <Trash2 size={12} aria-hidden />
      {pending
        ? "清空中…"
        : filtered
          ? `清空筛选结果（${matched}）`
          : `清空日志（${matched}）`}
    </Button>
  );
}
