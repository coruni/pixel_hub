"use server";

// 打赏 action。收款方**由服务端从作品反查作者**，不接受客户端传入 toUserId ——
// 否则可以构造「打赏 A 但付款说明指向 B」的错账，也可以绕过「不能打赏自己」的判定。
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { sendTip } from "@/lib/tip";
import type { ActionResult } from "@/lib/hooks";

export async function sendTipAction(input: {
  resourceId: string;
  coin: number;
  message?: string;
  /** 客户端一次性幂等 token（crypto.randomUUID） */
  token: string;
}): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "请先登录后再打赏" };

  // 复用全站限流：防连点刷屏
  if (!(await rateLimit(`tip:${userId}`, 20, 60_000))) {
    return { ok: false, error: "操作过于频繁，请稍后再试" };
  }

  const resourceId = input.resourceId.trim();
  if (!resourceId) return { ok: false, error: "缺少打赏目标" };

  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { authorId: true, slug: true },
  });
  if (!resource) return { ok: false, error: "作品不存在" };

  const res = await sendTip({
    fromUserId: userId,
    toUserId: resource.authorId,
    resourceId,
    coin: Math.trunc(input.coin),
    message: input.message ?? null,
    token: input.token,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath(`/resources/${resource.slug}`);
  revalidatePath("/me/coins");
  return { ok: true };
}

/**
 * 直接打赏作者（不挂作品，`TipRecord.resourceId = null`）。
 *
 * 【为什么这里必须收 toUserId】没有作品可反查收款方，toUserId 是唯一入口参数。
 * 但「不能打赏自己 / 收款方不存在 / 已被封禁」全部由 `sendTip` 在事务内再判一遍 ——
 * 客户端伪造 toUserId 最多把 PIX 打给另一个真人，构造不出「钱进 A、说明指向 B」的错账：
 * 附言不参与记账，收款方恒等于 toUserId。
 */
export async function sendUserTipAction(input: {
  toUserId: string;
  coin: number;
  message?: string;
  /** 客户端一次性幂等 token（crypto.randomUUID） */
  token: string;
}): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "请先登录后再打赏" };

  if (!(await rateLimit(`tip:${userId}`, 20, 60_000))) {
    return { ok: false, error: "操作过于频繁，请稍后再试" };
  }

  const toUserId = input.toUserId.trim();
  if (!toUserId) return { ok: false, error: "缺少打赏对象" };
  if (toUserId === userId) return { ok: false, error: "不能打赏自己" };

  const target = await prisma.user.findUnique({
    where: { id: toUserId },
    select: { username: true, bannedAt: true },
  });
  if (!target) return { ok: false, error: "用户不存在" };
  if (target.bannedAt) return { ok: false, error: "该用户已被封禁，暂时无法打赏" };

  const res = await sendTip({
    fromUserId: userId,
    toUserId,
    resourceId: null,
    coin: Math.trunc(input.coin),
    message: input.message ?? null,
    token: input.token,
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath(`/u/${target.username}`);
  revalidatePath("/me/coins");
  return { ok: true };
}
