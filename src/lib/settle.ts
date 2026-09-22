// 结算期（DB 层）—— 生成草稿 / 预览分配 / 偿付校验 / 确认锁定并入账 PIX。
// 分配算法本身在 settle-allocate.ts（纯函数）；本文件只负责读数据、算池子、写快照。
//
// 【跨期守恒的铁律】`poolFen = floor(本期收入 × 分成比例) + carryInFen`
// **carryIn 不再乘比例**。写成 `floor((收入 + carryIn) × 比例)` 会吞掉 `carryIn × (1 − 比例)` 的钱
// —— 没进池子，也没记成收入，无账可查。这条在计划 §3.1 有反例，验收脚本专门断言它不回归。
//
// 【确认的两段式】入账 PIX 是幂等的（`CoinLedger` 按 `SETTLE + periodId` 去重），
// 所以确认流程允许分两次跑完：先落快照 → 逐人入账 → 最后翻状态。
// 任何一步中断，重跑确认会**沿用已落库的快照**（不重算），只补没入账的人。
// 重算是危险的：重算可能得出与已入账不同的数字，那才是真正对不平的账。
//
// 数值一律来自 points-config.ts（后台可配），本文件不出现任何阈值字面量。
import type { IncentiveStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { checkSettlementGate, creditCoin, getSolvency, type Solvency } from "@/lib/coin";
import { getIncentive } from "@/lib/incentive";
import { fenToCoin, POINT_REASONS, applyPermille, type IncentiveConfig } from "@/lib/points-config";
import {
  allocate,
  periodRange,
  prevPeriodKey,
  type AllocEntry,
  type AllocOutcome,
} from "@/lib/settle-allocate";

export type PeriodRow = {
  id: string;
  periodKey: string;
  status: IncentiveStatus;
  revenueFen: number;
  ratePermille: number;
  carryInFen: number;
  poolFen: number;
  totalScore: number;
  paidFen: number;
  carryOutFen: number;
  confirmedAt: Date | null;
  note: string | null;
};

export type PayoutRow = {
  userId: string;
  username: string;
  name: string | null;
  avatarKey: string | null;
  score: number;
  rank: number;
  amountFen: number;
  coin: number;
  capped: boolean;
};

export type SettlementDraft = {
  periodKey: string;
  label: string;
  /** 已落库的结算期（可能不存在 = 还没落快照） */
  period: PeriodRow | null;
  // ---- 本期计算链（未落库时的预览值；已落库时读快照） ----
  revenueFen: number;
  ratePermille: number;
  carryInFen: number;
  poolFen: number;
  totalScore: number;
  entries: AllocEntry[];
  outcome: AllocOutcome;
  /** Σ 折合 PIX（入账后新增的负债） */
  newCoin: number;
  /** 折合负债（分） */
  newLiabilityFen: number;
  solvency: Solvency;
  gate: { ok: boolean; message?: string };
  /** 已确认期的明细快照 */
  payouts: PayoutRow[];
  /** 已入账的明细条数（用于显示进度 / 判断能否重置草稿） */
  creditedCount: number;
  /** 是否可确认（草稿期 + 闸门通过） */
  canConfirm: boolean;
};

/** 参与本期结算的贡献分（只统计「计入结算」的原因，按自然月窗口） */
export async function periodScores(
  periodKey: string,
  cfg: IncentiveConfig,
): Promise<AllocEntry[]> {
  const range = periodRange(periodKey);
  if (!range) return [];
  const reasons = POINT_REASONS.filter((r) => cfg.settleEligible[r] === true);
  if (reasons.length === 0) return [];
  const grouped = await prisma.pointLog.groupBy({
    by: ["userId"],
    where: {
      reason: { in: reasons },
      createdAt: { gte: range.start, lt: range.end },
    },
    _sum: { delta: true },
  });
  return grouped
    .map((g) => ({ userId: g.userId, score: Math.max(0, g._sum.delta ?? 0) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.userId < b.userId ? -1 : 1));
}

async function revenueOf(periodKey: string): Promise<number> {
  const agg = await prisma.revenueEntry.aggregate({
    where: { periodKey },
    _sum: { amountFen: true },
  });
  return agg._sum.amountFen ?? 0;
}

/** 上期已确认/已发放的 carryOutFen（**全额**转入本期，不再乘比例） */
async function carryInOf(periodKey: string): Promise<number> {
  const prev = prevPeriodKey(periodKey);
  if (!prev) return 0;
  const row = await prisma.incentivePeriod.findUnique({
    where: { periodKey: prev },
    select: { status: true, carryOutFen: true },
  });
  if (!row || row.status === "DRAFT") return 0;
  return row.carryOutFen;
}

function toPeriodRow(p: {
  id: string;
  periodKey: string;
  status: IncentiveStatus;
  revenueFen: number;
  ratePermille: number;
  carryInFen: number;
  poolFen: number;
  totalScore: number;
  paidFen: number;
  carryOutFen: number;
  confirmedAt: Date | null;
  note: string | null;
}): PeriodRow {
  return { ...p };
}

/** 生成（或复读）某期结算草稿。**只读**：不落库、不改任何数据 */
export async function buildDraft(periodKey: string): Promise<SettlementDraft | null> {
  const range = periodRange(periodKey);
  if (!range) return null;
  const cfg = await getIncentive();

  const existing = await prisma.incentivePeriod.findUnique({ where: { periodKey } });
  const rawPayouts = existing
    ? await prisma.incentivePayout.findMany({
        where: { periodId: existing.id },
        orderBy: { rank: "asc" },
        include: { user: { select: { username: true, name: true, avatarKey: true } } },
      })
    : [];
  const payouts: PayoutRow[] = rawPayouts.map((p) => ({
    userId: p.userId,
    username: p.user.username,
    name: p.user.name,
    avatarKey: p.user.avatarKey,
    score: p.score,
    rank: p.rank,
    amountFen: p.amountFen,
    coin: p.coin,
    capped: p.capped,
  }));
  const creditedCount = rawPayouts.filter((p) => p.coinCredited).length;

  const solvency = await getSolvency();

  // 已落库的快照优先：重跑确认时必须沿用已公示的数字，绝不重算
  if (existing) {
    const newLiabilityFen = payouts.reduce(
      (s, p) => s + Math.floor((p.amountFen * cfg.coin.perYuan) / 100),
      0,
    );
    const gate = checkSettlementGate(solvency, newLiabilityFen, cfg.solvency.insufficientStrategy);
    return {
      periodKey,
      label: range.label,
      period: toPeriodRow(existing),
      revenueFen: existing.revenueFen,
      ratePermille: existing.ratePermille,
      carryInFen: existing.carryInFen,
      poolFen: existing.poolFen,
      totalScore: existing.totalScore,
      entries: payouts.map((p) => ({ userId: p.userId, score: p.score })),
      outcome: {
        rows: payouts.map((p) => ({
          userId: p.userId,
          score: p.score,
          amountFen: p.amountFen,
          capped: p.capped,
          rank: p.rank,
        })),
        belowMin: [],
        excluded: [],
        paidFen: existing.paidFen,
        carryOutFen: existing.carryOutFen,
      },
      newCoin: payouts.reduce((s, p) => s + p.coin, 0),
      newLiabilityFen,
      solvency,
      gate: gate.ok ? { ok: true } : { ok: false, message: gate.message },
      payouts,
      creditedCount,
      canConfirm: existing.status === "DRAFT" && (gate.ok || gate.allowScale),
    };
  }

  // 未落库：按计算链现算预览
  const [revenueFen, carryInFen, entries] = await Promise.all([
    revenueOf(periodKey),
    carryInOf(periodKey),
    periodScores(periodKey, cfg),
  ]);
  const ratePermille = cfg.settlement.ratePermille;
  // ⚠️ 分成比例只作用于本期新增收入；carryIn **原样**并入（见文件头铁律）
  const poolFen = applyPermille(revenueFen, ratePermille) + carryInFen;
  const outcome = allocate(poolFen, entries, {
    minScore: cfg.settlement.minScore,
    minPayoutFen: cfg.settlement.minPayoutFen,
    capPermille: cfg.settlement.capPermille,
    capIterations: cfg.settlement.capIterations,
  });
  const newCoin = outcome.rows.reduce((s, r) => s + fenToCoin(r.amountFen, cfg.coin.perYuan), 0);
  const newLiabilityFen = outcome.rows.reduce(
    (s, r) => s + Math.floor((r.amountFen * cfg.coin.perYuan) / 100),
    0,
  );
  const gate = checkSettlementGate(solvency, newLiabilityFen, cfg.solvency.insufficientStrategy);
  const totalScore = entries.reduce((s, e) => s + e.score, 0);

  return {
    periodKey,
    label: range.label,
    period: null,
    revenueFen,
    ratePermille,
    carryInFen,
    poolFen,
    totalScore,
    entries,
    outcome,
    newCoin,
    newLiabilityFen,
    solvency,
    gate: gate.ok ? { ok: true } : { ok: false, message: gate.message },
    payouts: [],
    creditedCount: 0,
    canConfirm: poolFen > 0 && outcome.rows.length > 0 && (gate.ok || gate.allowScale),
  };
}

export type ConfirmResult =
  | { ok: true; periodId: string; credited: number; coin: number }
  | { ok: false; error: string };

/**
 * 确认结算期：落快照 → 逐人入账 PIX（幂等）→ 翻状态。
 * 幂等可重跑：已有快照时沿用快照，只补未入账的明细。
 */
export async function confirmPeriod(periodKey: string, adminId: string): Promise<ConfirmResult> {
  const cfg = await getIncentive();
  if (!cfg.enabled) return { ok: false, error: "激励体系已关闭，无法确认结算" };

  const existing = await prisma.incentivePeriod.findUnique({ where: { periodKey } });
  if (existing && existing.status !== "DRAFT") {
    return { ok: false, error: `该期已是「${existing.status}」状态，不能重复确认` };
  }

  let periodId = existing?.id ?? "";

  if (!existing) {
    const draft = await buildDraft(periodKey);
    if (!draft) return { ok: false, error: "结算期格式不正确（应为 YYYY-MM）" };
    if (draft.outcome.rows.length === 0) return { ok: false, error: "本期没有可发放的分配明细" };

    // 资金不足策略：reject 直接拒（默认）；scale 按可用安全额度等比缩减
    let rows = draft.outcome.rows;
    let carryOutFen = draft.outcome.carryOutFen;
    if (!draft.gate.ok) {
      if (cfg.solvency.insufficientStrategy !== "scale") {
        return { ok: false, error: draft.gate.message ?? "可用资金不足，已拒绝确认" };
      }
      const room = Math.max(0, draft.solvency.safeLimitFen - draft.solvency.liabilityFen);
      if (room <= 0) return { ok: false, error: "可用安全额度为 0，无法按比例缩减，请先核对收入" };
      const scaled = rows
        .map((r) => ({
          ...r,
          amountFen: Math.floor((r.amountFen * room) / draft.newLiabilityFen),
          capped: true,
        }))
        .filter((r) => r.amountFen >= cfg.settlement.minPayoutFen);
      const scaledPaid = scaled.reduce((s, r) => s + r.amountFen, 0);
      carryOutFen = draft.poolFen - scaledPaid;
      rows = scaled.map((r, i) => ({ ...r, rank: i + 1 }));
    }

    const created = await prisma.$transaction(async (tx) => {
      const p = await tx.incentivePeriod.create({
        data: {
          periodKey,
          status: "DRAFT",
          revenueFen: draft.revenueFen,
          ratePermille: draft.ratePermille,
          carryInFen: draft.carryInFen,
          poolFen: draft.poolFen,
          totalScore: draft.totalScore,
          paidFen: rows.reduce((s, r) => s + r.amountFen, 0),
          carryOutFen,
          configSnapshot: JSON.stringify(cfg),
        },
        select: { id: true },
      });
      await tx.incentivePayout.createMany({
        data: rows.map((r) => ({
          periodId: p.id,
          userId: r.userId,
          score: r.score,
          rank: r.rank,
          amountFen: r.amountFen,
          coin: fenToCoin(r.amountFen, cfg.coin.perYuan),
          capped: r.capped,
        })),
      });
      return p.id;
    });
    periodId = created;
  }

  // 逐人入账（幂等：refId = periodId，`@@unique([userId, kind, refId])` 兜底）
  const pending = await prisma.incentivePayout.findMany({
    where: { periodId, coinCredited: false },
    select: { id: true, userId: true, coin: true, amountFen: true, rank: true },
    orderBy: { rank: "asc" },
  });
  let credited = 0;
  let coin = 0;
  for (const p of pending) {
    if (p.coin <= 0) {
      await prisma.incentivePayout.update({ where: { id: p.id }, data: { coinCredited: true } });
      continue;
    }
    const applied = await creditCoin({
      userId: p.userId,
      coin: p.coin,
      kind: "SETTLE",
      refType: "SETTLE_PERIOD",
      refId: periodId,
      note: `第 ${periodKey} 期激励结算`,
    });
    // applied 为 null = 余额不足（不可能，入账是加）或已入过账 —— 两种都视为已完成
    await prisma.incentivePayout.update({ where: { id: p.id }, data: { coinCredited: true } });
    if (applied) {
      credited += 1;
      coin += p.coin;
    }
  }

  const left = await prisma.incentivePayout.count({
    where: { periodId, coinCredited: false },
  });
  if (left > 0) return { ok: false, error: `仍有 ${left} 条明细未入账，请重试确认` };

  await prisma.incentivePeriod.update({
    where: { id: periodId },
    data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedBy: adminId },
  });
  return { ok: true, periodId, credited, coin };
}

/** 重置草稿（仅在**无任何已入账明细**时允许）：删草稿期的明细，便于按新配置重算 */
export async function resetDraftPeriod(periodKey: string): Promise<{ ok: boolean; error?: string }> {
  const period = await prisma.incentivePeriod.findUnique({ where: { periodKey } });
  if (!period) return { ok: true };
  if (period.status !== "DRAFT") return { ok: false, error: "已确认的期不可重置（已公示的数字必须可复算）" };
  const credited = await prisma.incentivePayout.count({
    where: { periodId: period.id, coinCredited: true },
  });
  if (credited > 0) return { ok: false, error: `已有 ${credited} 条明细入账，不可重置` };
  await prisma.$transaction(async (tx) => {
    await tx.incentivePayout.deleteMany({ where: { periodId: period.id } });
    await tx.incentivePeriod.delete({ where: { id: period.id } });
  });
  return { ok: true };
}

/** 结算期列表（/creators 公示、/fund ③ 用） */
export async function listPeriods(take = 12): Promise<PeriodRow[]> {
  const rows = await prisma.incentivePeriod.findMany({
    where: { status: { in: ["CONFIRMED", "PAID"] } },
    orderBy: { periodKey: "desc" },
    take,
    select: {
      id: true,
      periodKey: true,
      status: true,
      revenueFen: true,
      ratePermille: true,
      carryInFen: true,
      poolFen: true,
      totalScore: true,
      paidFen: true,
      carryOutFen: true,
      confirmedAt: true,
      note: true,
    },
  });
  return rows.map(toPeriodRow);
}

/** 某期明细（公示用；只取展示字段，**不含任何个人金额之外的信息**） */
export async function periodPayouts(periodId: string): Promise<PayoutRow[]> {
  const rows = await prisma.incentivePayout.findMany({
    where: { periodId },
    orderBy: { rank: "asc" },
    include: { user: { select: { username: true, name: true, avatarKey: true } } },
  });
  return rows.map((p) => ({
    userId: p.userId,
    username: p.user.username,
    name: p.user.name,
    avatarKey: p.user.avatarKey,
    score: p.score,
    rank: p.rank,
    amountFen: p.amountFen,
    coin: p.coin,
    capped: p.capped,
  }));
}

/** 参与本期结算的人数（草稿预览的头部数字） */
export async function periodParticipantCount(periodId: string): Promise<number> {
  return prisma.incentivePayout.count({ where: { periodId } });
}

/**
 * 各期参与人数（公示列表用）。
 * 一次 `groupBy` 拿全，别在页面里按期循环 count —— 那是 N 次往返，公示页会随期数变慢。
 */
export async function payoutCounts(periodIds: string[]): Promise<Map<string, number>> {
  if (periodIds.length === 0) return new Map();
  const rows = await prisma.incentivePayout.groupBy({
    by: ["periodId"],
    where: { periodId: { in: periodIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.periodId, r._count._all]));
}

/** 收入录入 */
export async function addRevenue(input: {
  periodKey: string;
  source: string;
  amountFen: number;
  receivedAt: Date;
  note?: string | null;
  createdBy: string;
}): Promise<void> {
  await prisma.revenueEntry.create({
    data: {
      periodKey: input.periodKey,
      source: input.source,
      amountFen: input.amountFen,
      receivedAt: input.receivedAt,
      note: input.note ?? null,
      createdBy: input.createdBy,
    },
  });
}

export type RevenueRow = {
  id: string;
  periodKey: string;
  source: string;
  amountFen: number;
  receivedAt: Date;
  note: string | null;
  createdAt: Date;
};

export async function listRevenue(periodKey: string): Promise<RevenueRow[]> {
  return prisma.revenueEntry.findMany({
    where: { periodKey },
    orderBy: { receivedAt: "desc" },
  });
}

/** 冲正：删掉某条收入录入（只在结算期仍是 DRAFT 时允许，否则等于事后改已公示数字） */
export async function deleteRevenue(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.revenueEntry.findUnique({
    where: { id },
    select: { periodKey: true },
  });
  if (!row) return { ok: false, error: "记录不存在" };
  const period = await prisma.incentivePeriod.findUnique({
    where: { periodKey: row.periodKey },
    select: { status: true },
  });
  if (period && period.status !== "DRAFT") {
    return { ok: false, error: "该期已确认，已公示的数字不可事后修改" };
  }
  await prisma.revenueEntry.delete({ where: { id } });
  return { ok: true };
}

/** 异常提示：单人占当期总分比例过高（只提示，不拦截） */
export type AnomalyUser = { userId: string; username: string; sharePermille: number; score: number };
/** 异常提示：同一个**触发者**给全站贡献的分值占比过高（刷分通常长这样） */
export type AnomalyActor = { actorId: string; username: string; sharePermille: number; score: number };
export type SettlementAnomalies = { hotUsers: AnomalyUser[]; hotActors: AnomalyActor[] };

/**
 * 异常提示（只提示、不拦截）：两类都查，因为它们的形态不同 ——
 * ① 「集中于单人」= 某个**得分人**拿了当期过高比例的池子（可能是真热门，也可能是被刷）；
 * ② 「集中于单一 actorId」= 某个**触发者**产出的分值占了全站主要比例 ——
 *    刷分账号的特征就是「一个人给无数作品点赞/下载」，它自己的分不高，但它是分值的源头。
 */
export async function settlementAnomalies(periodKey: string): Promise<SettlementAnomalies> {
  const cfg = await getIncentive();
  const range = periodRange(periodKey);
  if (!range) return { hotUsers: [], hotActors: [] };

  const entries = await periodScores(periodKey, cfg);
  const total = entries.reduce((s, e) => s + e.score, 0);
  if (total <= 0) return { hotUsers: [], hotActors: [] };

  const reasons = POINT_REASONS.filter((r) => cfg.settleEligible[r] === true);
  const hotUsersRaw = entries
    .filter((e) => Math.floor((e.score * 10000) / total) >= cfg.risk.anomalySharePermille)
    .filter((e) => e.score >= cfg.risk.anomalyMinDelta);

  const actorRows =
    reasons.length === 0
      ? []
      : await prisma.pointLog.groupBy({
          by: ["actorId"],
          where: {
            reason: { in: reasons },
            actorId: { not: null },
            createdAt: { gte: range.start, lt: range.end },
          },
          _sum: { delta: true },
        });
  const hotActorsRaw = actorRows
    .map((a) => ({ actorId: a.actorId as string, score: Math.max(0, a._sum.delta ?? 0) }))
    .filter((a) => a.score >= cfg.risk.anomalyMinDelta)
    .filter((a) => Math.floor((a.score * 10000) / total) >= cfg.risk.anomalySharePermille);

  const ids = [...new Set([...hotUsersRaw.map((e) => e.userId), ...hotActorsRaw.map((a) => a.actorId)])];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true },
      })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.username]));

  return {
    hotUsers: hotUsersRaw.map((e) => ({
      userId: e.userId,
      username: nameOf.get(e.userId) ?? e.userId,
      sharePermille: Math.floor((e.score * 10000) / total),
      score: e.score,
    })),
    hotActors: hotActorsRaw.map((a) => ({
      actorId: a.actorId,
      username: nameOf.get(a.actorId) ?? a.actorId,
      sharePermille: Math.floor((a.score * 10000) / total),
      score: a.score,
    })),
  };
}
