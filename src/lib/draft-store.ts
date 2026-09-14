import { prisma } from "@/lib/db/prisma";
import {
  DRAFT_MAX_PER_USER,
  draftTitleOf,
  parseDraftPayload,
  type DraftPayload,
} from "@/lib/draft";

/**
 * 草稿读写（server-only）：独立于 actions 层，发布成功后的「清草稿」也从这里走，
 * 避免在 "use server" 文件里导出非 action 的辅助函数。
 *
 * 所有入口都带 ownerId 过滤——草稿是私密内容，任何路径都不允许跨用户读写。
 */

export type DraftRow = {
  id: string;
  type: DraftPayload["type"];
  title: string;
  payload: DraftPayload;
  updatedAt: Date;
};

/** 超量裁剪：每人只保留最新 DRAFT_MAX_PER_USER 条，多余的按最旧丢弃 */
export async function pruneDrafts(ownerId: string): Promise<void> {
  const stale = await prisma.resourceDraft.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    skip: DRAFT_MAX_PER_USER,
    select: { id: true },
  });
  if (stale.length > 0)
    await prisma.resourceDraft.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
}

/**
 * 写入草稿。id 命中本人草稿则原地更新，否则（无 id / id 不属于本人 / 已被删除）新建一条。
 * 返回最终落库的 id，前端据此接续后续自动保存。
 */
export async function saveDraft(
  ownerId: string,
  id: string | null,
  payload: DraftPayload,
): Promise<{ id: string; updatedAt: Date }> {
  const title = draftTitleOf(payload).slice(0, 200);
  const payloadText = JSON.stringify(payload);

  if (id) {
    const owned = await prisma.resourceDraft.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    if (owned) {
      const row = await prisma.resourceDraft.update({
        where: { id: owned.id },
        data: { type: payload.type, title, payload: payloadText },
        select: { id: true, updatedAt: true },
      });
      return row;
    }
  }
  const row = await prisma.resourceDraft.create({
    data: { ownerId, type: payload.type, title, payload: payloadText },
    select: { id: true, updatedAt: true },
  });
  return row;
}

/** 删除草稿（仅限本人；不存在也算成功，删除按钮可重复点） */
export async function discardDraft(ownerId: string, id: string): Promise<void> {
  if (!id) return;
  await prisma.resourceDraft.deleteMany({ where: { id, ownerId } }).catch(() => {});
}

/** 读单条草稿（仅限本人） */
export async function getDraft(
  ownerId: string,
  id: string,
): Promise<{ id: string; type: string; payload: DraftPayload; updatedAt: Date } | null> {
  if (!id) return null;
  const row = await prisma.resourceDraft.findFirst({
    where: { id, ownerId },
    select: { id: true, type: true, payload: true, updatedAt: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    payload: parseDraftPayload(row.type, row.payload),
    updatedAt: row.updatedAt,
  };
}

/** 草稿箱列表（最新在前，不返回媒体大字段以外的东西） */
export async function listDrafts(ownerId: string, take = DRAFT_MAX_PER_USER): Promise<DraftRow[]> {
  const rows = await prisma.resourceDraft.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, type: true, title: true, payload: true, updatedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type as DraftPayload["type"],
    title: r.title,
    payload: parseDraftPayload(r.type, r.payload),
    updatedAt: r.updatedAt,
  }));
}

/** 草稿条数（用于入口角标） */
export async function countDrafts(ownerId: string): Promise<number> {
  return prisma.resourceDraft.count({ where: { ownerId } });
}

/** 用户是否开启自动保存（设置项；查不到按开启处理） */
export async function autoSaveEnabled(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { autoSaveDraft: true },
  });
  return row?.autoSaveDraft !== false;
}
