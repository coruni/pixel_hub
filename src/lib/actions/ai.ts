"use server";

// 网站管家 AI 任务编排与建议审核 actions。
// 边界：AI 只生成任务/建议草稿；只有"接受建议"才通过 updateResourceAdminAction 触碰资源，
// 全程不直接写 Resource/Media。game.research 未接入真实检索适配器，执行时明确失败。
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { adminOnly, audit, staff } from "@/lib/actions/_guards";
import { providerFromConfig } from "@/lib/ai/provider";
import { getRuntimeConfig, aiModel as cfgAiModel } from "@/lib/runtime-config";
import { buildRedactedInput } from "@/lib/ai/redact";
import {
  aiTaskKindSchema,
  assertTaskExecutionSupported,
  parseStructuredOutput,
  suggestionItemSchema,
  taskContracts,
} from "@/lib/ai/schema";
import { regeneratedTaskKey } from "@/lib/ai/enqueue";
import {
  buildResourceSuggestionForm,
  mergeSuggestionDecision,
  parseSuggestionDecision,
} from "@/lib/ai/suggestions";
import { updateResourceAdminAction } from "@/lib/actions/admin-content";
import { parseMeta } from "@/lib/meta";
import { publicUrl } from "@/lib/storage";

type Kind = z.infer<typeof aiTaskKindSchema>;

const inputSchema = z.object({
  kind: aiTaskKindSchema,
  resourceId: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});
const fieldInputSchema = z.object({
  suggestionId: z.string().min(1),
  field: suggestionItemSchema.shape.field,
  editedValue: z.string().max(20_000).optional(),
});
export type AiActionState = { ok?: boolean; error?: string; taskId?: string; status?: string };

const kindToDb = {
  "resource.enrich": "RESOURCE_ENRICH",
  "resource.review": "RESOURCE_REVIEW",
  "image.describe": "IMAGE_DESCRIBE",
  "game.research": "GAME_RESEARCH",
  "site.overview": "SITE_OVERVIEW",
} as const;
const dbToKind = Object.fromEntries(
  Object.entries(kindToDb).map(([slug, db]) => [db, slug]),
) as Record<string, Kind>;

/** 从任务输入里挑出可访问的图片地址（含相对站内 URL，需 SITE_URL/AUTH_URL 才能转绝对）。 */
function imageUrlsFromInput(inputJson: string): string[] {
  const input = JSON.parse(inputJson) as {
    resource?: { media?: Array<{ url?: string; mime?: string | null }> };
  };
  const base = process.env.SITE_URL?.trim() || process.env.AUTH_URL?.trim();
  return (input.resource?.media ?? [])
    .filter((media) => media.mime?.toLowerCase().startsWith("image/") && media.url)
    .map((media) => {
      if (/^(https?:\/\/|data:image\/)/i.test(media.url!)) return media.url!;
      if (!base) throw new Error("图片描述失败：相对媒体地址需要配置 SITE_URL");
      return new URL(media.url!, base).toString();
    });
}

/** 创建（或幂等复用）一个排队任务。只落任务与来源行，不调用模型。 */
export async function createAiTaskAction(raw: z.input<typeof inputSchema>): Promise<AiActionState> {
  const me = await staff();
  if (!me) return { error: "无权限" };
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { error: "任务参数不正确" };
  const { kind, resourceId, input, idempotencyKey } = parsed.data;
  // game.research / site.overview 无资源目标：前者首期失败，后者输入为站点聚合快照。
  if (kind !== "game.research" && kind !== "site.overview" && !resourceId)
    return { error: "该任务需要资源" };

  // 幂等：同一键已存在则直接返回既有任务，避免触发器/重复点击产生重复任务。
  const existing = await prisma.aiTask.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true },
  });
  if (existing) return { ok: true, taskId: existing.id, status: existing.status };

  let payload: Record<string, unknown> = { ...(input ?? {}) };
  if (resourceId) {
    const resource = await prisma.resource.findUnique({
      where: { id: resourceId },
      select: {
        id: true,
        title: true,
        summary: true,
        description: true,
        type: true,
        meta: true,
        externalUrl: true,
        slug: true,
        media: {
          select: {
            id: true,
            mime: true,
            fileName: true,
            width: true,
            height: true,
            storageKey: true,
            bigKey: true,
          },
        },
      },
    });
    if (!resource) return { error: "资源不存在" };
    payload = {
      ...payload,
      resource: {
        ...resource,
        meta: parseMeta(resource.type, resource.meta),
        media: resource.media.map((media) => ({
          ...media,
          url: publicUrl(media.bigKey ?? media.storageKey),
        })),
      },
    };
  }

  let task;
  try {
    task = await prisma.aiTask.create({
      data: {
        kind: kindToDb[kind],
        status: "QUEUED",
        inputJson: JSON.stringify(buildRedactedInput(payload)),
        promptVersion: taskContracts[kind].promptVersion,
        createdById: me.id,
        idempotencyKey,
      },
      select: { id: true, status: true },
    });
  } catch (error) {
    // 并发创建撞唯一键：抓回先建成的同键任务，视为成功。
    if ((error as { code?: string }).code !== "P2002") throw error;
    const concurrent = await prisma.aiTask.findUnique({
      where: { idempotencyKey },
      select: { id: true, status: true },
    });
    if (!concurrent) return { error: "任务创建冲突，请重试" };
    return { ok: true, taskId: concurrent.id, status: concurrent.status };
  }
  if (resourceId)
    await prisma.aiSource.create({
      data: { taskId: task.id, kind: "USER_INPUT", locator: resourceId, title: "资源输入" },
    });
  await audit(me.id, "CREATE_AI_TASK", "AI_TASK", task.id, kind);
  revalidatePath("/admin/ai");
  return { ok: true, taskId: task.id, status: task.status };
}

/** 执行一个排队任务：调用 provider、解析结构化输出、落建议与运行记录。 */
export async function executeAiTaskAction(taskId: string): Promise<AiActionState> {
  const me = await staff();
  if (!me) return { error: "无权限" };
  const task = await prisma.aiTask.findUnique({ where: { id: taskId } });
  if (!task) return { error: "任务不存在" };
  if (task.status === "SUCCEEDED") return { ok: true, taskId, status: task.status };
  const kind = dbToKind[task.kind];
  if (!kind) return { error: "任务类型不受支持" };
  const startedAt = new Date();
  let runId: string | undefined;
  try {
    // 后台运行配置（cache() 同请求去重）：AiRun 的 model 记录与 provider 构造共用
    const runtimeCfg = await getRuntimeConfig();
    // 原子抢占：只有把 QUEUED 置为 RUNNING 的调用方才能继续，防并发重复执行。
    const claim = await prisma.$transaction(async (tx) => {
      const changed = await tx.aiTask.updateMany({
        where: { id: taskId, status: "QUEUED" },
        data: { status: "RUNNING" },
      });
      if (!changed.count) return null;
      return tx.aiRun.create({
        data: {
          taskId,
          provider: "openai-compatible",
          model: cfgAiModel(runtimeCfg),
          status: "RUNNING",
          startedAt,
        },
        select: { id: true },
      });
    });
    if (!claim) {
      const latest = await prisma.aiTask.findUnique({
        where: { id: taskId },
        select: { status: true },
      });
      return { error: latest?.status === "RUNNING" ? "任务正在执行" : "任务当前不可执行" };
    }
    runId = claim.id;

    assertTaskExecutionSupported(kind);
    const imageUrls = kind === "image.describe" ? imageUrlsFromInput(task.inputJson) : [];
    if (kind === "image.describe" && !imageUrls.length)
      throw new Error("图片描述失败：没有可访问的图片输入");

    const contract = taskContracts[kind];
    const provider = await providerFromConfig();
    const result = await provider.complete({
      system: contract.systemPrompt,
      user: JSON.stringify({ kind, input: JSON.parse(task.inputJson) }),
      imageUrls,
    });
    const output = parseStructuredOutput(contract.outputSchema as z.ZodTypeAny, result.content);
    const completedAt = new Date();

    // 建议、任务终态、运行终态同一事务提交，避免半成功状态。
    await prisma.$transaction(async (tx) => {
      await tx.aiSuggestion.create({
        data: { taskId, status: "PENDING", outputJson: JSON.stringify(output) },
      });
      await tx.aiTask.update({
        where: { id: taskId, status: "RUNNING" },
        data: { status: "SUCCEEDED" },
      });
      await tx.aiRun.update({
        where: { id: runId },
        data: {
          status: "SUCCEEDED",
          completedAt,
          durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
          ...result.usage,
        },
      });
    });
    await audit(me.id, "EXECUTE_AI_TASK", "AI_TASK", taskId);
    revalidatePath("/admin/ai");
    return { ok: true, taskId, status: "SUCCEEDED" };
  } catch (error) {
    const completedAt = new Date();
    const failureData = {
      status: "FAILED" as const,
      completedAt,
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : "unknown",
    };
    const cleanUp = () => prisma.aiSuggestion.deleteMany({ where: { taskId, status: "PENDING" } });
    try {
      await prisma.$transaction([
        cleanUp(),
        prisma.aiTask.updateMany({
          where: { id: taskId, status: "RUNNING" },
          data: { status: "FAILED" },
        }),
        ...(runId
          ? [
              prisma.aiRun.updateMany({
                where: { id: runId, status: "RUNNING" },
                data: failureData,
              }),
            ]
          : []),
      ]);
    } catch {
      await Promise.allSettled([
        cleanUp(),
        prisma.aiTask.updateMany({
          where: { id: taskId, status: "RUNNING" },
          data: { status: "FAILED" },
        }),
        ...(runId
          ? [
              prisma.aiRun.updateMany({
                where: { id: runId, status: "RUNNING" },
                data: failureData,
              }),
            ]
          : []),
      ]);
    }
    await audit(
      me.id,
      "FAIL_AI_TASK",
      "AI_TASK",
      taskId,
      error instanceof Error ? error.message.slice(0, 500) : undefined,
    );
    revalidatePath("/admin/ai");
    return {
      error:
        kind === "game.research" ? "游戏资料联网检索尚未实现" : "AI 任务执行失败，请检查配置后重试",
    };
  }
}

/** 失败任务回到排队态，并立即尝试重新执行。 */
export async function retryAiTaskAction(taskId: string): Promise<AiActionState> {
  const me = await staff();
  if (!me) return { error: "无权限" };
  const changed = await prisma.aiTask.updateMany({
    where: { id: taskId, status: "FAILED" },
    data: { status: "QUEUED" },
  });
  if (!changed.count) return { error: "只有失败任务可重试" };
  await audit(me.id, "RETRY_AI_TASK", "AI_TASK", taskId);
  return executeAiTaskAction(taskId);
}

/** 以新幂等键复制任务输入重新生成（原任务保留，便于对照）。 */
export async function regenerateAiTaskAction(taskId: string): Promise<AiActionState> {
  const me = await staff();
  if (!me) return { error: "无权限" };
  const source = await prisma.aiTask.findUnique({
    where: { id: taskId },
    include: { sources: true },
  });
  if (!source) return { error: "任务不存在" };
  if (source.status === "RUNNING") return { error: "任务正在执行" };
  const fresh = await prisma.aiTask.create({
    data: {
      kind: source.kind,
      status: "QUEUED",
      inputJson: source.inputJson,
      promptVersion: source.promptVersion,
      createdById: me.id,
      idempotencyKey: regeneratedTaskKey(source.idempotencyKey ?? source.id, randomUUID()),
      sources: {
        create: source.sources.map((item) => ({
          kind: item.kind,
          title: item.title,
          locator: item.locator,
          excerpt: item.excerpt,
          trustLevel: item.trustLevel,
          fetchedAt: item.fetchedAt,
        })),
      },
    },
    select: { id: true },
  });
  await audit(me.id, "REGENERATE_AI_TASK", "AI_TASK", fresh.id, `from ${taskId}`);
  return executeAiTaskAction(fresh.id);
}

/**
 * 接受某个字段建议：委托现有 updateResourceAdminAction 应用到资源。
 * 用 PENDING→PROCESSING 原子抢占防并发；失败回滚为 PENDING。
 */
export async function acceptAiSuggestionAction(
  suggestionId: string,
  field: string,
  editedValue?: string,
): Promise<AiActionState> {
  const me = await adminOnly();
  if (!me) return { error: "无权限" };
  const input = fieldInputSchema.safeParse({ suggestionId, field, editedValue });
  if (!input.success) return { error: "建议字段不正确" };
  const suggestion = await prisma.aiSuggestion.findUnique({
    where: { id: suggestionId },
    include: { task: true },
  });
  if (!suggestion) return { error: "建议不存在" };
  if (suggestion.task.status !== "SUCCEEDED") return { error: "任务尚未成功完成，暂不能接受建议" };
  if (suggestion.status !== "PENDING") return { error: "建议已处理" };

  const output = JSON.parse(suggestion.outputJson) as { suggestions?: unknown[] };
  const items = z.array(suggestionItemSchema).safeParse(output.suggestions ?? []);
  if (!items.success) return { error: "建议内容格式不正确" };
  const selected = items.data.find((item) => item.field === input.data.field);
  if (!selected) return { error: "建议字段不存在" };
  const decision = parseSuggestionDecision(suggestion.decisionJson);
  if (decision.accepted.includes(selected.field) || decision.rejected.includes(selected.field))
    return { error: "该字段已处理" };

  const claimed = await prisma.aiSuggestion.updateMany({
    where: { id: suggestionId, status: "PENDING" },
    data: { status: "PROCESSING" },
  });
  if (!claimed.count) return { error: "建议状态已变化，请刷新后重试" };

  try {
    const resourceId = (JSON.parse(suggestion.task.inputJson) as { resource?: { id?: string } })
      .resource?.id;
    if (!resourceId) throw new Error("resource_missing");
    const resource = await prisma.resource.findUnique({
      where: { id: resourceId },
      select: {
        id: true,
        type: true,
        categoryId: true,
        title: true,
        summary: true,
        description: true,
        externalUrl: true,
        meta: true,
        nsfw: true,
        loginRequired: true,
        allowComments: true,
        isDownloadable: true,
        coverMediaId: true,
        tags: { select: { tag: { select: { name: true } } } },
        media: { orderBy: { sort: "asc" }, select: { id: true } },
      },
    });
    if (!resource) throw new Error("resource_missing");

    const form = buildResourceSuggestionForm(resource, {
      field: selected.field,
      value: input.data.editedValue ?? selected.value,
    });
    const result = await updateResourceAdminAction({}, form);
    if (result.error || result.fieldErrors) throw new Error("resource_update_failed");

    const next = mergeSuggestionDecision(decision, selected.field, "accepted");
    const allFields = new Set(items.data.map((item) => item.field));
    const complete = [...allFields].every(
      (name) => next.accepted.includes(name) || next.rejected.includes(name),
    );
    await prisma.aiSuggestion.update({
      where: { id: suggestionId, status: "PROCESSING" },
      data: {
        status: complete ? "ACCEPTED" : "PENDING",
        decisionJson: JSON.stringify(next),
        reviewedById: me.id,
        reviewedAt: new Date(),
      },
    });
    await audit(me.id, "ACCEPT_AI_SUGGESTION_FIELD", "AI_SUGGESTION", suggestionId, selected.field);
    revalidatePath("/admin/ai");
    return { ok: true };
  } catch (error) {
    await prisma.aiSuggestion.updateMany({
      where: { id: suggestionId, status: "PROCESSING" },
      data: { status: "PENDING" },
    });
    return {
      error:
        error instanceof Error && error.message === "resource_missing"
          ? "资源不存在"
          : "建议接受失败，请刷新后重试",
    };
  }
}

/** 拒绝字段建议；field 缺省表示整条建议拒绝。 */
export async function rejectAiSuggestionAction(
  suggestionId: string,
  field?: string,
): Promise<AiActionState> {
  const me = await adminOnly();
  if (!me) return { error: "无权限" };
  const suggestion = await prisma.aiSuggestion.findUnique({
    where: { id: suggestionId },
    include: { task: { select: { status: true } } },
  });
  if (!suggestion) return { error: "建议不存在" };
  if (suggestion.task.status !== "SUCCEEDED") return { error: "任务尚未成功完成，暂不能处理建议" };
  if (suggestion.status !== "PENDING") return { error: "建议已处理" };

  if (!field) {
    const changed = await prisma.aiSuggestion.updateMany({
      where: { id: suggestionId, status: "PENDING" },
      data: { status: "REJECTED", reviewedById: me.id, reviewedAt: new Date() },
    });
    if (!changed.count) return { error: "建议状态已变化，请刷新后重试" };
  } else {
    const parsedField = suggestionItemSchema.shape.field.safeParse(field);
    if (!parsedField.success) return { error: "建议字段不正确" };
    const output = JSON.parse(suggestion.outputJson) as { suggestions?: unknown[] };
    const items = z.array(suggestionItemSchema).safeParse(output.suggestions ?? []);
    if (!items.success || !items.data.some((item) => item.field === parsedField.data))
      return { error: "建议字段不存在" };
    const claimed = await prisma.aiSuggestion.updateMany({
      where: { id: suggestionId, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    if (!claimed.count) return { error: "建议状态已变化，请刷新后重试" };
    const decision = mergeSuggestionDecision(
      parseSuggestionDecision(suggestion.decisionJson),
      parsedField.data,
      "rejected",
    );
    const allFields = new Set(items.data.map((item) => item.field));
    const complete = [...allFields].every(
      (name) => decision.accepted.includes(name) || decision.rejected.includes(name),
    );
    await prisma.aiSuggestion.update({
      where: { id: suggestionId, status: "PROCESSING" },
      data: {
        status: complete ? "REJECTED" : "PENDING",
        decisionJson: JSON.stringify(decision),
        reviewedById: me.id,
        reviewedAt: new Date(),
      },
    });
  }
  await audit(
    me.id,
    field ? "REJECT_AI_SUGGESTION_FIELD" : "REJECT_AI_SUGGESTION",
    "AI_SUGGESTION",
    suggestionId,
    field,
  );
  revalidatePath("/admin/ai");
  return { ok: true };
}

// 前端可读性更佳的名字（保留语义别名，避免改名破坏既有调用约定）。
export const createTaskAction = createAiTaskAction;
export const executeTaskAction = executeAiTaskAction;
export const retryTaskAction = retryAiTaskAction;
export const acceptSuggestionAction = acceptAiSuggestionAction;
export const rejectSuggestionAction = rejectAiSuggestionAction;
