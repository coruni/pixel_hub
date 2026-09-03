"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";

export type SettingsActionState = { ok?: boolean; error?: string; fieldErrors?: Record<string, string[]> };

const profileSchema = z.object({
  name: z.string().trim().min(0).max(30, "昵称最长 30 字"),
  bio: z.string().trim().max(200, "简介最长 200 字"),
});

export async function updateProfileAction(
  _prev: SettingsActionState,
  fd: FormData
): Promise<SettingsActionState> {
  const user = (await auth())?.user;
  if (!user) return { error: "请先登录" };

  const parsed = profileSchema.safeParse({
    name: fd.get("name") ?? "",
    bio: fd.get("bio") ?? "",
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const { name, bio } = parsed.data;

  await prisma.user.update({
    where: { id: user.id },
    data: { name: name || null, bio: bio || null },
  });
  revalidatePath(`/u/${user.username}`);
  revalidatePath("/settings");
  return { ok: true };
}
