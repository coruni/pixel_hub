// 打赏 —— 站内 PIX 转账。**不经过任何支付通道，平台不经手真钱。**
//
// 【为什么它天然抗刷】A 打赏 B：A 的 PIX 减少、B 的 PIX 增加，**系统内 PIX 总量不变**。
// 小号互刷除了浪费时间什么都得不到 —— 不产生贡献分、不产生新 PIX、也不影响榜单。
// 这条性质是「打赏」与「赞助」的分界线：赞助是真钱进站（走 payment.ts），打赏只是搬运。
//
// 【不产生贡献分】打赏不调用 awardPoints，也不计入结算 —— 它是价值转移，不是「被认可」。
//
// 【幂等】客户端为每次提交生成一次性 token，`refId = tip:<token>`。
// `CoinLedger @@unique([userId, kind, refId])` 让重复提交在**改动余额之前**被拦下：
// 一次打赏只产生一笔 TipRecord 与两条 CoinLedger（发出方 −N、接收方 +N）。
//
// 数值一律来自 points-config.ts（后台可配），本文件不出现任何阈值字面量。
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { applyCoin } from "@/lib/coin";
import { getIncentive } from "@/lib/incentive";
import { createNotification } from "@/lib/notify";

export type TipInput = {
  fromUserId: string;
  toUserId: string;
  /** 关联作品（可空 = 直接打赏作者） */
  resourceId?: string | null;
  coin: number;
  message?: string | null;
  /** 客户端一次性幂等 token（crypto.randomUUID） */
  token: string;
};

export type TipResult =
  | { ok: true; tipId: string; duplicate: boolean }
  | { ok: false; error: string };

/** 事务内失败用的哨兵：带着用户可读原因往上抛，外层转成 TipResult */
class TipReject extends Error {}

export async function sendTip(input: TipInput): Promise<TipResult> {
  const cfg = await getIncentive();
  if (!cfg.tip.enabled) return { ok: false, error: "打赏功能当前未开放" };

  const coin = Math.trunc(input.coin);
  if (!Number.isInteger(coin) || coin <= 0) return { ok: false, error: "打赏数量必须是正整数" };
  if (coin < cfg.tip.minCoin || coin > cfg.tip.maxCoin) {
    return {
      ok: false,
      error: `单笔打赏需在 ${cfg.tip.minCoin} – ${cfg.tip.maxCoin} ${cfg.coin.symbol} 之间`,
    };
  }
  if (input.fromUserId === input.toUserId) return { ok: false, error: "不能打赏自己" };

  const token = input.token.trim().slice(0, 64);
  if (!token) return { ok: false, error: "请求标识缺失，请重试" };
  const refId = `tip:${token}`;

  // 幂等预检：已有同 refId 的支出流水 → 视为重复提交，不再动余额
  const dup = await prisma.coinLedger.findUnique({
    where: {
      userId_kind_refId: { userId: input.fromUserId, kind: "TIP_SENT", refId },
    },
    select: { id: true },
  });
  if (dup) return { ok: true, tipId: "", duplicate: true };

  const message = cfg.tip.messageMax > 0
    ? input.message?.trim().slice(0, cfg.tip.messageMax) || null
    : null;

  try {
    const tipId = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: input.toUserId },
        select: { bannedAt: true },
      });
      if (!target) throw new TipReject("收款用户不存在");
      if (target.bannedAt) throw new TipReject("该用户已被封禁，暂时无法打赏");

      if (input.resourceId) {
        const res = await tx.resource.findUnique({
          where: { id: input.resourceId },
          select: { status: true },
        });
        if (!res || res.status !== "PUBLISHED") throw new TipReject("只能打赏已上架的作品");
      }

      const tip = await tx.tipRecord.create({
        data: {
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          resourceId: input.resourceId ?? null,
          coin,
          message,
        },
        select: { id: true },
      });

      // 出账在前：余额不足直接中止（不出账就不该给收款方加账）
      const out = await applyCoin(tx, {
        userId: input.fromUserId,
        delta: -coin,
        kind: "TIP_SENT",
        refType: "TIP",
        refId,
        note: message ? `打赏：${message}` : "打赏",
        lifetime: { tippedOut: coin },
      });
      if (!out) throw new TipReject("可用余额不足（提现冻结中的 PIX 不能用于打赏）");

      const inn = await applyCoin(tx, {
        userId: input.toUserId,
        delta: coin,
        kind: "TIP_RECEIVED",
        refType: "TIP",
        refId,
        note: message ? `收到打赏：${message}` : "收到打赏",
        lifetime: { earned: coin },
      });
      if (!inn) throw new TipReject("收款方记账失败，请稍后重试");

      return tip.id;
    });

    // 通知是副通道（失败不影响已完成的转账）
    await createNotification({
      userId: input.toUserId,
      actorId: input.fromUserId,
      type: "SYSTEM",
      resourceId: input.resourceId ?? null,
      message: `收到 ${coin} ${cfg.coin.symbol} 打赏${message ? `：「${message}」` : ""}`,
    });

    return { ok: true, tipId, duplicate: false };
  } catch (e) {
    if (e instanceof TipReject) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: true, tipId: "", duplicate: true };
    }
    console.error("[tip] 打赏失败", e);
    return { ok: false, error: "打赏失败，请稍后重试" };
  }
}

// ---------- 读侧 ----------

export type TipRow = {
  id: string;
  coin: number;
  message: string | null;
  createdAt: Date;
  resourceId: string | null;
  resourceTitle: string | null;
  /** 对方用户名（收到 → 打赏人；发出 → 被打赏人） */
  counterparty: { username: string; name: string | null; avatarKey: string | null };
};

/** 我收到的打赏 */
export async function getTipsReceived(userId: string, take: number): Promise<TipRow[]> {
  const rows = await prisma.tipRecord.findMany({
    where: { toUserId: userId },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      fromUser: { select: { username: true, name: true, avatarKey: true } },
      resource: { select: { title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    coin: r.coin,
    message: r.message,
    createdAt: r.createdAt,
    resourceId: r.resourceId,
    resourceTitle: r.resource?.title ?? null,
    counterparty: r.fromUser,
  }));
}

/** 我发出的打赏 */
export async function getTipsSent(userId: string, take: number): Promise<TipRow[]> {
  const rows = await prisma.tipRecord.findMany({
    where: { fromUserId: userId },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      toUser: { select: { username: true, name: true, avatarKey: true } },
      resource: { select: { title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    coin: r.coin,
    message: r.message,
    createdAt: r.createdAt,
    resourceId: r.resourceId,
    resourceTitle: r.resource?.title ?? null,
    counterparty: r.toUser,
  }));
}

/** 某作品累计收到多少打赏 PIX（详情页展示；打赏榜默认关闭，这里只给总额） */
export async function resourceTipTotal(resourceId: string): Promise<{ coin: number; count: number }> {
  const agg = await prisma.tipRecord.aggregate({
    where: { resourceId },
    _sum: { coin: true },
    _count: { _all: true },
  });
  return { coin: agg._sum.coin ?? 0, count: agg._count._all };
}
