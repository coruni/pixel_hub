"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { draftPayloadSchema } from "@/lib/draft";
import { discardDraft, pruneDrafts, saveDraft } from "@/lib/draft-store";

/**
 * 草稿箱 action：自动保存 / 手动保存 / 删除 / 自动保存开关。
 * 草稿是私密数据，每个入口都以会话 userId 为准，不接受客户端传入的 ownerId。
 */

export type SaveDraftState =
  | { ok: true; id: string; savedAt: string }
  | { ok: false; error: string };

/** 写操作前统一校验：登录 + 未封禁 */
async function writableUser() {
  const u = (await auth())?.user;
  if (!u) return { id: null as string | null, error: "请先登录" };
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { bannedAt: true } });
  if (!row || row.bannedAt) return { id: null as string | null, error: "账号不可用" };
  return { id: u.id, error: null as string | null };
}

/**
 * 保存草稿。payload 由客户端按 ./draft 的 collectDraft 收集，服务端再过一遍 schema
 * （既兜脏数据，也挡住伪造的超长 payload）。
 */
export async function saveDraftAction(input: {
  id?: string | null;
  payload: unknown;
}): Promise<SaveDraftState> {
  const { id: uid, error } = await writableUser();
  if (!uid) return { ok: false, error: error ?? "请先登录" };

  // 自动保存是高频写（约 2s 一次），配额放到 10 分钟 120 次，仍能压住脚本刷写
  if (!(await rateLimit(`draft:${uid}`, 120, 10 * 60_000)))
    return { ok: false, error: "保存过于频繁，请稍后再试" };

  const parsed = draftPayloadSchema.safeParse(input?.payload);
  if (!parsed.success) return { ok: false, error: "草稿内容不合法" };

  const rawId = typeof input?.id === "string" && input.id.length <= 64 ? input.id : null;

  try {
    const row = await saveDraft(uid, rawId, parsed.data);
    // 超量裁剪放写成功之后：即使裁剪失败也不影响本次保存结果
    await pruneDrafts(uid).catch(() => {});
    return { ok: true, id: row.id, savedAt: row.updatedAt.toISOString() };
  } catch (e) {
    console.error("[draft-save]", e);
    return { ok: false, error: "草稿保存失败" };
  }
}

/** 删除单条草稿（草稿箱 / 恢复后丢弃） */
export async function deleteDraftAction(id: string): Promise<{ ok: boolean }> {
  const { id: uid } = await writableUser();
  if (!uid) return { ok: false };
  await discardDraft(uid, typeof id === "string" ? id : "");
  revalidatePath("/settings");
  return { ok: true };
}

/** 清空我的全部草稿 */
export async function clearDraftsAction(): Promise<{ ok: boolean; removed: number }> {
  const { id: uid } = await writableUser();
  if (!uid) return { ok: false, removed: 0 };
  const res = await prisma.resourceDraft.deleteMany({ where: { ownerId: uid } });
  revalidatePath("/settings");
  return { ok: true, removed: res.count };
}

/** 自动保存开关（用户级设置，设置页与发布页共用同一入口） */
export async function setAutoSaveDraftAction(
  next: boolean,
): Promise<{ ok: boolean; autoSave: boolean }> {
  const { id: uid } = await writableUser();
  if (!uid) return { ok: false, autoSave: true };
  await prisma.user.update({ where: { id: uid }, data: { autoSaveDraft: next === true } });
  revalidatePath("/settings");
  revalidatePath("/upload");
  return { ok: true, autoSave: next === true };
}
