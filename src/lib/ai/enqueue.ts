// 资源创建后的 AI 触发器：只入队 QUEUED 任务、记录来源，绝不调用模型或写 Resource，
// 因此发布/审核/redirect 响应不被阻塞；幂等键由数据库唯一约束兜底并发重复。
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/actions/_guards";
import { buildRedactedInput } from "@/lib/ai/redact";
import { publicUrl } from "@/lib/storage";
import { taskContracts } from "@/lib/ai/schema";

export type ResourceAiTriggerKind = "resource.enrich" | "image.describe";

const dbKind = {
  "resource.enrich": "RESOURCE_ENRICH",
  "image.describe": "IMAGE_DESCRIBE",
} as const;

/** 固定幂等键：同一资源同种任务只允许一个触发任务。 */
export function aiTriggerIdempotencyKey(kind: ResourceAiTriggerKind, resourceId: string): string {
  return `resource:${resourceId}:${kind}:v1`;
}

/** 重新生成使用新后缀（非空），不削弱原幂等键并保证长度不超库列限制。 */
export function regeneratedTaskKey(baseKey: string, nonce: string): string {
  const suffix = `:regenerate:${nonce}`;
  return `${baseKey.slice(0, Math.max(0, 200 - suffix.length))}${suffix}`;
}

/** 按内容缺口决定需要哪些任务：缺简介 → enrich；含 image/* 媒体 → image.describe。 */
export function resourceAiTriggerKinds(
  summary: string | null | undefined,
  mediaMimes: Array<string | null | undefined>,
): ResourceAiTriggerKind[] {
  const kinds: ResourceAiTriggerKind[] = [];
  if (!summary?.trim()) kinds.push("resource.enrich");
  if (mediaMimes.some((mime) => mime?.toLowerCase().startsWith("image/")))
    kinds.push("image.describe");
  return kinds;
}

/**
 * 入队资源 AI 任务。供资源创建成功后 fire-and-forget：任何失败（含 DB）都不改变发布契约。
 * 调用方（after() 钩子）负责 catch 记录日志。
 */
export async function enqueueResourceAiTriggers(
  resourceId: string,
  createdById: string,
): Promise<void> {
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
          kind: true,
          fileName: true,
          mime: true,
          width: true,
          height: true,
          storageKey: true,
          bigKey: true,
        },
      },
    },
  });
  if (!resource) return;

  const kinds = resourceAiTriggerKinds(
    resource.summary,
    resource.media.map((media) => media.mime),
  );

  await Promise.all(
    kinds.map(async (kind) => {
      const idempotencyKey = aiTriggerIdempotencyKey(kind, resource.id);
      let task;
      try {
        task = await prisma.aiTask.create({
          data: {
            kind: dbKind[kind],
            status: "QUEUED",
            inputJson: JSON.stringify(
              buildRedactedInput({
                resource: {
                  ...resource,
                  media: resource.media.map((media) => ({
                    ...media,
                    url: publicUrl(media.bigKey ?? media.storageKey),
                  })),
                },
              }),
            ),
            promptVersion: taskContracts[kind].promptVersion,
            createdById,
            idempotencyKey,
          },
          select: { id: true },
        });
      } catch (error) {
        // 并发发布/重试撞唯一幂等键：视为已存在即可；其余失败抛给调用方记录。
        if ((error as { code?: string }).code !== "P2002") throw error;
        return;
      }
      await prisma.aiSource.create({
        data: { taskId: task.id, kind: "USER_INPUT", locator: resource.id, title: "资源输入" },
      });
      await audit(createdById, "CREATE_AI_TASK", "AI_TASK", task.id, kind);
    }),
  );
}
