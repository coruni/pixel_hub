"use client";

import { useAction } from "@/lib/hooks";
import { confirmDialog, promptDialog } from "@/components/ui/feedback";
import { BTN_DANGER_SM, BTN_GHOST_SM } from "@/lib/ui/cls";
import {
  approveResourceAction,
  rejectResourceAction,
  restoreResource,
  setResourceRemoved,
  handleReportBatchAction,
  setUserBanned,
  setUserRole,
  setUserTrusted,
} from "@/lib/actions/moderation";
import { Button } from "@/components/ui/Button";

const OK =
  "rounded-none px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white transition hover:bg-emerald-500 disabled:opacity-50";

export function QueueActions({ resourceId }: { resourceId: string }) {
  const { run, pending } = useAction();
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() => run(() => approveResourceAction(resourceId))}
        className={OK}
      >
        {pending ? "处理中…" : "通过"}
      </Button>
      <Button
        type="button"
        disabled={pending}
        onClick={async () => {
          const reason = await promptDialog({
            title: "打回内容",
            message: "打回原因会通知作者。",
            placeholder: "填写打回原因…",
            required: true,
            multiline: true,
            confirmLabel: "打回",
          });
          if (reason === null) return;
          run(() => rejectResourceAction(resourceId, reason));
        }}
        className="rounded-none px-3 py-1.5 text-xs font-medium border border-amber-300 text-amber-700 transition hover:bg-amber-50 disabled:opacity-50"
      >
        {pending ? "处理中…" : "打回"}
      </Button>
    </div>
  );
}

export function ContentActions({ resourceId, status }: { resourceId: string; status: string }) {
  const { run, pending } = useAction();
  if (status === "PUBLISHED")
    return (
      <Button
        type="button"
        disabled={pending}
        onClick={async () => {
          const ok = await confirmDialog({
            title: "下架内容",
            message: "确认下架该内容？作者将收到通知。",
            confirmLabel: "下架",
            danger: true,
          });
          if (!ok) return;
          run(() => setResourceRemoved(resourceId));
        }}
        className={BTN_DANGER_SM}
      >
        {pending ? "处理中…" : "下架"}
      </Button>
    );
  if (status === "REMOVED")
    return (
      <Button
        type="button"
        disabled={pending}
        onClick={() => run(() => restoreResource(resourceId))}
        className={BTN_GHOST_SM}
      >
        {pending ? "处理中…" : "恢复上架"}
      </Button>
    );
  return <span className="text-xs text-neutral-400">{status}</span>;
}

export function ReportActions({
  type,
  targetId,
  resourceStatus,
}: {
  type: "RESOURCE" | "COMMENT" | "USER";
  targetId?: string | null;
  resourceStatus?: string | null;
}) {
  const { run, pending } = useAction();
  const isRes = type === "RESOURCE";
  const removed = isRes && resourceStatus === "REMOVED";
  const paused = isRes && resourceStatus === "PENDING"; // 因举报正被暂挂复查
  const base = {
    type,
    resourceId: isRes ? targetId : null,
    commentId: type === "COMMENT" ? targetId : null,
    userId: type === "USER" ? targetId : null,
  };
  const confirm = () => run(() => handleReportBatchAction({ ...base, decision: "confirm" }));
  const dismiss = () => run(() => handleReportBatchAction({ ...base, decision: "dismiss" }));
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={async () => {
          if (paused) {
            const ok = await confirmDialog({
              title: "驳回举报",
              message: "驳回举报并将该内容恢复上架？",
              confirmLabel: "驳回并恢复",
            });
            if (!ok) return;
          }
          dismiss();
        }}
        className={BTN_GHOST_SM}
      >
        {pending ? "处理中…" : paused ? "驳回举报·恢复上架" : "驳回举报"}
      </Button>
      <Button
        type="button"
        disabled={pending}
        onClick={async () => {
          if (!removed) {
            const ok = await confirmDialog({
              title: "确认违规",
              message: "确认违规（内容将被下架）并关闭全部同类举报？",
              confirmLabel: "确认违规",
              danger: true,
            });
            if (!ok) return;
          }
          confirm();
        }}
        className={`rounded-none px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
          removed
            ? "border border-brand-200 text-neutral-500 hover:bg-neutral-100"
            : "bg-red-600 text-white hover:bg-red-500"
        }`}
      >
        {pending
          ? "处理中…"
          : isRes && !removed
            ? "确认违规·下架"
            : "确认违规"}
      </Button>
    </div>
  );
}

export function UserActions({
  userId,
  isSelf,
  role,
  trusted,
  banned,
}: {
  userId: string;
  isSelf: boolean;
  role: "USER" | "MODERATOR" | "ADMIN";
  trusted: boolean;
  banned: boolean;
}) {
  const { run, pending } = useAction();
  if (isSelf) return <span className="text-xs text-neutral-400">（你）</span>;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        disabled={pending || banned}
        onClick={() => run(() => setUserTrusted(userId, !trusted))}
        className={`rounded-none px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
          trusted
            ? "border border-brand-200 text-neutral-600 hover:bg-neutral-100"
            : "bg-emerald-600 text-white hover:bg-emerald-500"
        }`}
      >
        {pending ? "处理中…" : trusted ? "取消免审" : "设为免审"}
      </Button>
      {!banned && (
        <select
          defaultValue={role}
          disabled={pending}
          onChange={(e) =>
            run(() => setUserRole(userId, e.target.value as "USER" | "MODERATOR" | "ADMIN"))
          }
          className="rounded-none border border-brand-200 bg-surface px-2 py-1.5 text-xs disabled:opacity-50"
        >
          <option value="USER">普通用户</option>
          <option value="MODERATOR">版主</option>
          <option value="ADMIN">管理员</option>
        </select>
      )}
      <Button
        type="button"
        disabled={pending}
        onClick={async () => {
          if (banned) {
            run(() => setUserBanned(userId, false));
            return;
          }
          const reason = await promptDialog({
            title: "封禁用户",
            message: "填写封禁原因（可选），仅后台可见。",
            placeholder: "封禁原因…",
            confirmLabel: "封禁",
          });
          if (reason === null) return;
          run(() => setUserBanned(userId, true, reason || undefined));
        }}
        className={`rounded-none px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
          banned
            ? "bg-neutral-200 text-neutral-600 hover:bg-neutral-300"
            : "border border-red-300 text-red-600 hover:bg-red-50"
        }`}
      >
        {pending ? "处理中…" : banned ? "解封" : "封禁"}
      </Button>
    </div>
  );
}
