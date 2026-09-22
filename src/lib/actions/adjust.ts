"use server";

// 人工调整贡献分 / PIX（后台 /admin/incentive 的「人工调整」面板）。
//
// 【为什么必须有这条路】自动化计分总有出错的时候（漏计、误计、被刷），
// 没有人工修正通道，唯一的办法就是直接改库 —— 而直接改库是**没有审计**的，
// 事后没人知道那个数字是怎么来的。这里每一笔都写 `PointLog` / `CoinLedger` + `AuditLog`。
//
// 【为什么两个都强制填理由】调整是「人对数字的判断」，理由是这个判断的唯一留痕。
// 理由可以短，但不能空。
//
// 【为什么按用户名而不是 userId 操作】操作者手上只有用户名。让前端先查 id 再提交，
// 只是把「查错人」的机会从服务端挪到前端，还多一次往返。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { adminOnly, audit } from "@/lib/actions/_guards";
import { getIncentive } from "@/lib/incentive";
import { awardPoints } from "@/lib/points";
import { levelOf } from "@/lib/points-config";
import { creditCoin, debitCoin, getCoinAccount } from "@/lib/coin";
import type { ActionResult } from "@/lib/hooks";

/** 单次调整的绝对值上限：超过这个数几乎一定是多打了一个 0 */
const MAX_DELTA = 100_000_000;

export type AdjustTarget = {
  userId: string;
  username: string;
  name: string | null;
  points: number;
  level: number;
  /** 是否在冻结名单（只停计分；人工调整不受它拦截） */
  frozen: boolean;
  coin: {
    balance: number;
    frozen: number;
    lifetimeEarned: number;
    lifetimeWithdrawn: number;
  };
};

export type LookupResult = { ok: true; target: AdjustTarget } | { ok: false; error: string };

/** 按用户名（或 id）查目标账号的当前分值/代币，用于操作前核对 */
export async function lookupAdjustTargetAction(username: string): Promise<LookupResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const key = username.trim().replace(/^@/, "");
  if (!key) return { ok: false, error: "请输入用户名" };

  const u = await prisma.user.findFirst({
    where: { OR: [{ username: key }, { id: key }] },
    select: { id: true, username: true, name: true, points: { select: { balance: true } } },
  });
  if (!u) return { ok: false, error: `找不到用户「${key}」` };

  const cfg = await getIncentive();
  const account = await getCoinAccount(u.id);
  const points = u.points?.balance ?? 0;

  return {
    ok: true,
    target: {
      userId: u.id,
      username: u.username,
      name: u.name,
      points,
      level: levelOf(points, cfg.levels),
      frozen: cfg.risk.frozenUserIds.includes(u.id),
      coin: {
        balance: account.balance,
        frozen: account.frozen,
        lifetimeEarned: account.lifetimeEarned,
        lifetimeWithdrawn: account.lifetimeWithdrawn,
      },
    },
  };
}

function revalidateAdjust() {
  revalidatePath("/admin/incentive");
  revalidatePath("/creators");
  revalidatePath("/creators/me");
  revalidatePath("/me/coins");
  revalidatePath("/admin/finance");
  revalidatePath("/fund");
}

/** 校验公共入参（用户名 / 增量 / 理由） */
function parseInput(input: { username: string; delta: number; note?: string }):
  | { ok: true; delta: number; note: string }
  | { ok: false; error: string } {
  const delta = Math.trunc(Number(input.delta));
  if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: "调整值必须是非 0 整数" };
  if (Math.abs(delta) > MAX_DELTA) return { ok: false, error: "调整值过大，请检查是否多打了 0" };
  const note = (input.note ?? "").trim().slice(0, 200);
  if (note.length < 2) return { ok: false, error: "请填写调整理由（至少 2 个字）" };
  return { ok: true, delta, note };
}

/** 人工调整贡献分（正=补，负=扣）。扣到负数会被拒绝 —— 贡献分是荣誉，负分没有意义 */
export async function adjustPointsAction(input: {
  username: string;
  delta: number;
  note?: string;
}): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const parsed = parseInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const key = input.username.trim().replace(/^@/, "");
  const u = await prisma.user.findFirst({
    where: { OR: [{ username: key }, { id: key }] },
    select: { id: true, username: true, points: { select: { balance: true } } },
  });
  if (!u) return { ok: false, error: `找不到用户「${key}」` };

  const before = u.points?.balance ?? 0;
  if (before + parsed.delta < 0) {
    return { ok: false, error: `扣减后贡献分为负（当前 ${before}），请减小扣减量` };
  }

  const done = await awardPoints({
    userId: u.id,
    actorId: admin.id,
    reason: "ADMIN_ADJUST",
    refId: null, // 人工调整可反复进行，不受幂等键约束
    delta: parsed.delta,
    note: parsed.note,
    bypassFrozen: true, // 冻结只停自动计分，不挡人工修正
  });
  if (!done) return { ok: false, error: "调整未生效（激励体系已关闭或写入失败）" };

  await audit(
    admin.id,
    "ADJUST_POINTS",
    "USER",
    u.id,
    `${u.username} ${parsed.delta > 0 ? "+" : ""}${parsed.delta}：${parsed.note}`,
  );
  revalidateAdjust();
  return { ok: true };
}

/**
 * 人工调整 PIX（正=补发，负=扣回）。
 * 走 `CoinLedger`，所以 Σ流水 === 余额 这条不变量不会被人工调整破坏。
 * 注意：补发 PIX 会**抬高负债水位**（代币变多而现金没变），扣回则相反。
 */
export async function adjustCoinAction(input: {
  username: string;
  delta: number;
  note?: string;
}): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const parsed = parseInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const key = input.username.trim().replace(/^@/, "");
  const u = await prisma.user.findFirst({
    where: { OR: [{ username: key }, { id: key }] },
    select: { id: true, username: true },
  });
  if (!u) return { ok: false, error: `找不到用户「${key}」` };

  const cfg = await getIncentive();
  const note = `人工调整：${parsed.note}`;

  const applied =
    parsed.delta > 0
      ? await creditCoin({
          userId: u.id,
          coin: parsed.delta,
          kind: "ADMIN_ADJUST",
          refType: "ADMIN",
          refId: null,
          note,
          // 人工补发不计入「累计获得」—— 那个数字要能反映真实贡献，
          // 补偿性质的分不该混进去（否则提现对账时看不出区别）
          countLifetime: false,
        })
      : await debitCoin({
          userId: u.id,
          coin: -parsed.delta,
          kind: "ADMIN_ADJUST",
          refType: "ADMIN",
          refId: null,
          note,
        });

  if (!applied) {
    return {
      ok: false,
      error:
        parsed.delta < 0
          ? `可用 ${cfg.coin.symbol} 不足（当前 ${(await getCoinAccount(u.id)).balance}）`
          : "调整失败，请重试",
    };
  }

  await audit(
    admin.id,
    "ADJUST_COIN",
    "USER",
    u.id,
    `${u.username} ${parsed.delta > 0 ? "+" : ""}${parsed.delta} ${cfg.coin.symbol}：${parsed.note}`,
  );
  revalidateAdjust();
  return { ok: true };
}
