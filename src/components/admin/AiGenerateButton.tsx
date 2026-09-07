"use client";

import { useAction } from "@/lib/hooks";
import { createAiTaskAction, executeAiTaskAction, regenerateAiTaskAction } from "@/lib/actions/ai";
import { BTN_GHOST_SM } from "@/lib/ui/cls";

/** 内容编辑页的「生成 AI 建议」入口：稳定幂等键，重复点击复用同任务而非堆任务。 */
export default function AiGenerateButton({ resourceId }: { resourceId: string }) {
  const { run, pending } = useAction();
  return (
    <button
      type="button"
      disabled={pending}
      className={BTN_GHOST_SM}
      onClick={() =>
        run(async () => {
          const created = await createAiTaskAction({
            kind: "resource.enrich",
            resourceId,
            idempotencyKey: `manual-enrich:${resourceId}`,
          });
          if (!created.ok || !created.taskId) return { ok: !!created.ok, error: created.error };
          // 已成功/失败的旧任务视为历史草稿，重新生成新任务对照；其余直接执行排队任务。
          const executed =
            created.status === "SUCCEEDED" || created.status === "FAILED"
              ? await regenerateAiTaskAction(created.taskId)
              : await executeAiTaskAction(created.taskId);
          return { ok: !!executed.ok, error: executed.error };
        })
      }
    >
      {pending ? "生成中…" : "生成 AI 建议"}
    </button>
  );
}
