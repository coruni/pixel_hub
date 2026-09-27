"use client";

import { useAction } from "@/lib/hooks";
import { confirmDialog, promptDialog } from "@/components/ui/feedback";

import {
  approveResourceAction,
  rejectResourceAction,
  restoreResource,
  setResourceFeatured,
  setResourcePinned,
  setResourceRemoved,
  handleReportBatchAction,
  setUserBanned,
  setUserRole,
  setUserTrusted,
} from "@/lib/actions/moderation";
import { addResourceToFeaturedSectionAction } from "@/lib/actions/home";
import { Button } from "@/components/ui/Button";

export function QueueActions({ resourceId }: { resourceId: string }) {
  const { run, pending } = useAction();
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() => run(() => approveResourceAction(resourceId))}
        variant="success"
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

/**
 * 内容库行操作。两组：**运营标记**（置顶 / 精华 / 加入专题）与**状态操作**（下架 / 恢复上架）。
 *
 * 标记组只在已上架时出现：下架内容本来就不进列表流，置顶它没有意义；「加入专题」同理
 * —— 首页专题展示的是已上架内容。
 *
 * pinned / featured 由服务端把 pinnedAt / featuredAt 转成布尔后传入（日期在这层没用）。
 * 三个标记动作的权限都在服务端用 adminOnly 再判一次，前端只负责不渲染用不上的按钮。
 */
export function ContentActions({
  resourceId,
  status,
  pinned,
  featured,
}: {
  resourceId: string;
  status: string;
  pinned: boolean;
  featured: boolean;
}) {
  const { run, pending } = useAction();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {status === "PUBLISHED" && (
        <>
          <Button
            type="button"
            disabled={pending}
            size="sm"
            variant={pinned ? "primary" : "ghost"}
            title={pinned ? "取消后不再排在各列表最前" : "置顶：在所有列表里都排最前"}
            onClick={() => run(() => setResourcePinned(resourceId, !pinned))}
          >
            {pinned ? "取消置顶" : "置顶"}
          </Button>
          <Button
            type="button"
            disabled={pending}
            size="sm"
            variant={featured ? "warn" : "ghost"}
            title={
              featured
                ? "取消精华角标（已记给作者的贡献分不回收）"
                : "精华：卡片与详情页显示角标，并给作者记一次贡献分"
            }
            onClick={() => run(() => setResourceFeatured(resourceId, !featured))}
          >
            {featured ? "取消精华" : "精华"}
          </Button>
          <Button
            type="button"
            disabled={pending}
            size="sm"
            variant="ghost"
            title="追加到首页「专题」板块"
            onClick={() => run(() => addResourceToFeaturedSectionAction(resourceId))}
          >
            加入专题
          </Button>
        </>
      )}

      {status === "PUBLISHED" ? (
        <Button
          type="button"
          disabled={pending}
          size="sm"
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
          variant="danger"
        >
          {pending ? "处理中…" : "下架"}
        </Button>
      ) : status === "REMOVED" ? (
        <Button
          type="button"
          disabled={pending}
          size="sm"
          onClick={() => run(() => restoreResource(resourceId))}
          variant="ghost"
        >
          {pending ? "处理中…" : "恢复上架"}
        </Button>
      ) : (
        <span className="text-xs text-neutral-400">{status}</span>
      )}
    </div>
  );
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
        variant="ghost"
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
        variant={removed ? "ghost" : "dangerSolid"}
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
        variant={trusted ? "ghost" : "success"}
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
        variant={banned ? "ghost" : "danger"}
      >
        {pending ? "处理中…" : banned ? "解封" : "封禁"}
      </Button>
    </div>
  );
}
