"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { publishNotificationChanged } from "@/lib/realtime/publish";

// 每个写操作后都推一次 notify:changed：本标签页已 router.refresh()，
// 但同一账号的其它标签页/设备需要靠实时通道同步角标与列表。

export async function markAllNotificationsReadAction(): Promise<{ ok: boolean }> {
  const user = (await auth())?.user;
  if (!user) return { ok: false };
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  publishNotificationChanged(user.id);
  revalidatePath("/notifications");
  return { ok: true };
}

/** 标记单条已读：点击通知卡片时调用（只影响本人的通知） */
export async function markNotificationReadAction(id: string): Promise<{ ok: boolean }> {
  const user = (await auth())?.user;
  if (!user) return { ok: false };
  await prisma.notification.updateMany({
    where: { id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  publishNotificationChanged(user.id);
  revalidatePath("/notifications");
  return { ok: true };
}

/** 删除单条通知 */
export async function deleteNotificationAction(id: string): Promise<{ ok: boolean }> {
  const user = (await auth())?.user;
  if (!user) return { ok: false };
  await prisma.notification.deleteMany({ where: { id, userId: user.id } });
  publishNotificationChanged(user.id);
  revalidatePath("/notifications");
  return { ok: true };
}

/** 清空全部通知 */
export async function clearNotificationsAction(): Promise<{ ok: boolean }> {
  const user = (await auth())?.user;
  if (!user) return { ok: false };
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  publishNotificationChanged(user.id);
  revalidatePath("/notifications");
  return { ok: true };
}
