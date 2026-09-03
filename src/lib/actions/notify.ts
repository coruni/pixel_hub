"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";

export async function markAllNotificationsReadAction(): Promise<{ ok: boolean }> {
  const user = (await auth())?.user;
  if (!user) return { ok: false };
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
  return { ok: true };
}

/** 删除单条通知 */
export async function deleteNotificationAction(id: string): Promise<{ ok: boolean }> {
  const user = (await auth())?.user;
  if (!user) return { ok: false };
  await prisma.notification.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/notifications");
  return { ok: true };
}

/** 清空全部通知 */
export async function clearNotificationsAction(): Promise<{ ok: boolean }> {
  const user = (await auth())?.user;
  if (!user) return { ok: false };
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  revalidatePath("/notifications");
  return { ok: true };
}
