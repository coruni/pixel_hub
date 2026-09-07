"use server";

// 概览页「AI 运营建议」actions：按最近 7 日访客浏览快照生成站点级建议。
// 边界与资源类 AI 一致：只创建/执行 AiTask（模型输出存 suggestion），绝不直接写 Resource/Media；
// 快照本身为聚合数值，无 ipHash / 查询串等隐私。手动生成、同周期幂等。
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { staff } from "@/lib/actions/_guards";
import { regeneratedTaskKey } from "@/lib/ai/enqueue";
import {
  querySiteOverviewSnapshot,
  siteOverviewCycleDays,
  siteOverviewIdempotencyKey,
} from "@/lib/ai/site-insight";
import { createAiTaskAction, executeAiTaskAction, type AiActionState } from "@/lib/actions/ai";

export type SiteOverviewState = AiActionState;

async function buildInputSnapshot(): Promise<
  { error: string } | { snapshot: import("@/lib/ai/site-insight").SiteMetricsSnapshot }
> {
  const snapshot = await querySiteOverviewSnapshot();
  if (snapshot.totals.pv === 0)
    return { error: "近 7 日暂无访问数据，暂时无法生成有依据的运营建议" };
  return { snapshot };
}

/**
 * 「生成 AI 运营建议」：同周期幂等。已有同键任务 →
 * SUCCEEDED 直接复用；QUEUED/FAILED 转排队后交给抢占式执行；否则采最新快照建任务并立即执行。
 */
export async function runSiteOverviewAction(): Promise<SiteOverviewState> {
  const me = await staff();
  if (!me) return { error: "无权限" };
  const { from } = siteOverviewCycleDays();
  const idempotencyKey = siteOverviewIdempotencyKey(from);

  const existing = await prisma.aiTask.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true },
  });
  if (existing) {
    if (existing.status === "SUCCEEDED")
      return { ok: true, taskId: existing.id, status: existing.status };
    if (existing.status === "FAILED")
      await prisma.aiTask.updateMany({
        where: { id: existing.id, status: "FAILED" },
        data: { status: "QUEUED" },
      });
    // QUEUED（含刚转回的 FAILED）由 executeAiTaskAction 原子抢占，防并发重复调用。
    return executeAiTaskAction(existing.id);
  }

  const built = await buildInputSnapshot();
  if ("error" in built) return { error: built.error };
  const created = await createAiTaskAction({
    kind: "site.overview",
    input: built.snapshot as unknown as Record<string, unknown>,
    idempotencyKey,
  });
  if (!created.ok || !created.taskId) return { error: created.error ?? "任务创建失败" };
  return executeAiTaskAction(created.taskId);
}

/**
 * 「重新生成」：显式操作，无视当日已有结果——以最新快照建新任务再执行（原任务保留可对照）。
 */
export async function refreshSiteOverviewAction(): Promise<SiteOverviewState> {
  const me = await staff();
  if (!me) return { error: "无权限" };
  const built = await buildInputSnapshot();
  if ("error" in built) return { error: built.error };
  const { from } = siteOverviewCycleDays();
  const idempotencyKey = regeneratedTaskKey(siteOverviewIdempotencyKey(from), randomUUID());
  const created = await createAiTaskAction({
    kind: "site.overview",
    input: built.snapshot as unknown as Record<string, unknown>,
    idempotencyKey,
  });
  if (!created.ok || !created.taskId) return { error: created.error ?? "任务创建失败" };
  return executeAiTaskAction(created.taskId);
}
