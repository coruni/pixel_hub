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
