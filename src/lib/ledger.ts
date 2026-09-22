// 收支台账（LedgerEntry）—— **全站唯一写入口**。
//
// 纪律（计划 §3.4）：这张表**只记真钱进出**：收入到账、运营成本、创作者提现打款。
// 结算分配（向创作者入账 PIX）**不进这张表** —— 那只是代币负债上升，钱还没出去。
// 两件事混进一张表，账永远对不平。
//
// direction 由 `LEDGER_KIND_META` 派生后落库（库里存一份是为了 SQL 聚合方便），
// 所以任何调用方都不需要、也不允许自己传方向 —— 传错方向是一条不会被发现的账目错误。
//
// 幂等：`@@unique([kind, refId])`。同一张单据同一科目只可能有一条台账
// （例：支付回调重复推送时，INCOME_SPONSOR + orderId 只记一次）。
// refId 为空的手工录入不受约束（PG 里 NULL 互不相等），这正是「手工成本可多次录」的所需行为。
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { monthKey } from "@/lib/format";
import { LEDGER_KIND_META, type LedgerKind } from "@/lib/payment-config";

export type LedgerTx = Prisma.TransactionClient;

export type RecordLedgerInput = {
  kind: LedgerKind;
  /** 金额（分），**必须为正**；方向由科目决定 */
  amountFen: number;
  /** 归属期 YYYY-MM；缺省取当前自然月（与下载配额/结算期同一口径，见 format.monthKey） */
  periodKey?: string;
  note?: string | null;
  /** 关联单据类型：PAYMENT_ORDER | WITHDRAWAL | MANUAL */
  refType?: string;
  /** 关联单据 id，与 kind 组成幂等键；手工录入留空 */
  refId?: string | null;
  createdBy?: string | null;
};

/**
 * 记一笔台账（事务内调用）。返回 true = 记上了；false = 已记过（幂等命中）。
 * 方向永远从科目表派生，调用方无从传错。
 */
export async function recordLedger(tx: LedgerTx, input: RecordLedgerInput): Promise<boolean> {
  const amountFen = Math.trunc(input.amountFen);
  if (!Number.isFinite(amountFen) || amountFen <= 0) return false;

  if (input.refId) {
    const dup = await tx.ledgerEntry.findUnique({
      where: { kind_refId: { kind: input.kind, refId: input.refId } },
      select: { id: true },
    });
    if (dup) return false;
  }

  await tx.ledgerEntry.create({
    data: {
      periodKey: input.periodKey ?? monthKey(new Date()),
      kind: input.kind,
      direction: LEDGER_KIND_META[input.kind].direction,
      amountFen,
      note: input.note ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      createdBy: input.createdBy ?? null,
    },
  });
  return true;
}

/** 独立事务版本（后台录成本等单笔写场景；失败只记日志，不抛给调用方） */
export async function recordLedgerStandalone(input: RecordLedgerInput): Promise<boolean> {
  try {
    return await prisma.$transaction((tx) => recordLedger(tx, input));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    console.error("[ledger] 记账失败", e);
    return false;
  }
}

// ---------- 读侧 ----------

export type LedgerSums = {
  incomeFen: number;
  costFen: number;
  /** 创作者提现打款（OUT，但独立成组 —— 它不是「运营成本」） */
  paidFen: number;
  /** 赞助退款（OUT，独立成组 —— 它是「收入冲减」，不是成本） */
  refundFen: number;
  /** 可用现金 C = 收入 − 成本 − 已打款 − 退款 */
  cashFen: number;
};

/**
 * 按科目汇总真钱进出。**偿付水位的现金口径唯一实现**（coin.getSolvency 调它），
 * 别再在别处写第二份 kind → 方向的 if 链 —— 漏算一个科目是静默错误。
 */
export async function ledgerSums(): Promise<LedgerSums> {
  const rows = await prisma.ledgerEntry.groupBy({ by: ["kind"], _sum: { amountFen: true } });
  let incomeFen = 0;
  let costFen = 0;
  let paidFen = 0;
  let refundFen = 0;
  for (const row of rows) {
    const amount = row._sum.amountFen ?? 0;
    const meta = LEDGER_KIND_META[row.kind as LedgerKind];
    if (!meta) continue; // 未知科目（手工 SQL 写入）不计入水位，宁可少算也不乱算
    if (meta.direction === "IN") incomeFen += amount;
    else if (meta.group === "payout") paidFen += amount;
    else if (meta.group === "refund") refundFen += amount;
    else costFen += amount;
  }
  return {
    incomeFen,
    costFen,
    paidFen,
    refundFen,
    cashFen: incomeFen - costFen - paidFen - refundFen,
  };
}

export type LedgerRow = {
  id: string;
  periodKey: string;
  kind: LedgerKind;
  direction: string;
  amountFen: number;
  note: string | null;
  createdAt: Date;
};

/** 某期台账明细分页（游标：不重不漏，同一 createdAt 多条时也不出错） */
export async function listLedger(input: {
  periodKey?: string;
  take: number;
  cursor?: string | null;
}): Promise<LedgerRow[]> {
  const rows = await prisma.ledgerEntry.findMany({
    where: input.periodKey ? { periodKey: input.periodKey } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.take,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      periodKey: true,
      kind: true,
      direction: true,
      amountFen: true,
      note: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({ ...r, kind: r.kind as LedgerKind }));
}

/** 出现过的归属期（倒序），用于 /fund 的月份切换 */
export async function ledgerPeriods(take = 24): Promise<string[]> {
  const rows = await prisma.ledgerEntry.findMany({
    distinct: ["periodKey"],
    orderBy: { periodKey: "desc" },
    take,
    select: { periodKey: true },
  });
  return rows.map((r) => r.periodKey);
}

/** 累计数字条用：总笔数 */
export function ledgerCount(): Promise<number> {
  return prisma.ledgerEntry.count();
}
