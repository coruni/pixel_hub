// PIX 账户与流水（资产层）—— 全站 PIX 余额的**唯一写入口** + 偿付水位计算的**唯一实现**。
//
// ============================ 记账语义（改动前必读） ============================
//   CoinAccount.balance  = **可用** PIX（打赏/提现都只能动这一份）
//   CoinAccount.frozen   = 提现申请中冻结的 PIX（已离开可用，但仍是用户的钱）
//   CoinLedger.delta     = 对**可用余额**的变动（+ 入账 / − 出账）
//   CoinLedger.balance   = 记账后**可用余额**快照
//
// 【提现为什么只有一条 −N 流水】
//   计划 §2.4 写的是「冻结 → 驳回解冻 / 打款扣减」。若三个动作各写一条 −N/+N 流水，
//   用户会看到同一笔提现出现两条 −1000，像是双扣。这里按「现金与负债分离」（计划 §3.4）
//   的原则定为：
//     WITHDRAW_FREEZE 写流水 delta = −N（可用余额真的减少了）
//     WITHDRAW_REFUND 写流水 delta = +N（退回可用余额）
//     WITHDRAW_PAID   **不写 CoinLedger**，只 `frozen −= N` + `lifetimeWithdrawn += N`；
//                     真正的现金流出记在 `LedgerEntry(WITHDRAWAL_PAID, OUT)`。
//   理由：打款那一刻**没有任何 PIX 在动**（钱在冻结时就已不可用了），它是一次
//   「负债关门 + 现金出账」的事件，属于现金账，不属于 PIX 流水。
//
//   由此得到三条可反证的不变量（验收脚本据此断言）：
//     ① Σ CoinLedger.delta            === CoinAccount.balance
//     ② CoinAccount.frozen            === Σ{PENDING,APPROVED} WithdrawalRequest.coinAmount
//     ③ CoinAccount.lifetimeWithdrawn === Σ{PAID} WithdrawalRequest.coinAmount
//
// 【幂等】唯一约束 `@@unique([userId, kind, refId])` 是最后一道闸门：
// 结算按 `SETTLE + periodId`、打赏按 `TIP_* + tipRecordId`、冻结/解冻按 `WITHDRAW_* + withdrawalId`，
// 重复调用只会命中已有流水并**在改动余额之前**返回 null。
//
// 数值一律来自 points-config.ts（后台可配），本文件不出现任何阈值字面量。
import { Prisma } from "@prisma/client";
import type { CoinReason } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getIncentive } from "@/lib/incentive";
import { ledgerSums } from "@/lib/ledger";
import { FEN_PER_YUAN, PERMILLE_BASE } from "@/lib/points-config";

export type CoinTx = Prisma.TransactionClient;

/** 记账结果：null = 未记账（余额不足 / 已有同 (kind, refId) 流水） */
export type CoinApplied = { balance: number; frozen: number } | null;

type ApplyInput = {
  userId: string;
  /** 对**可用余额**的变动（正=入账，负=出账） */
  delta: number;
  /** 对**冻结额**的变动（提现冻结 +N / 解冻、打款 −N） */
  frozenDelta?: number;
  kind: CoinReason;
  refType?: string | null;
  /** 幂等键；为空时唯一约束不生效（手工调整用） */
  refId?: string | null;
  note?: string | null;
  /** 累计口径增量 */
  lifetime?: { earned?: number; withdrawn?: number; tippedOut?: number };
  /** 是否写 CoinLedger（默认写；WITHDRAW_PAID 由调用方传 false） */
  writeLedger?: boolean;
};

/**
 * 最小记账原语（**事务内调用**，不做自己的事务，便于打赏/结算把多笔记账包在一个事务里）。
 *
 * 出账用 `updateMany({ where: { balance: { gte: … } } })` 做**原子余额闸门**：
 * 先读后写会在并发下超支（两个请求同时读到 1000 都判定够扣），
 * 而这条 UPDATE 带条件，PG 会在行锁下重新求值，第二个请求 count === 0 → 拒绝。
 */
export async function applyCoin(tx: CoinTx, input: ApplyInput): Promise<CoinApplied> {
  const { delta, frozenDelta = 0 } = input;
  const writeLedger = input.writeLedger !== false;

  await tx.coinAccount.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId },
    update: {},
  });

  // 幂等预检：已有同 (kind, refId) 流水 → 直接返回，**不碰余额**
  // （refId 为空时不预检：PG 里 NULL 互不相等，唯一约束管不到，硬判会误杀手工调整）
  if (writeLedger && input.refId) {
    const dup = await tx.coinLedger.findUnique({
      where: {
        userId_kind_refId: { userId: input.userId, kind: input.kind, refId: input.refId },
      },
      select: { id: true },
    });
    if (dup) return null;
  }

  const lifetimeData = {
    ...(input.lifetime?.earned ? { lifetimeEarned: { increment: input.lifetime.earned } } : {}),
    ...(input.lifetime?.withdrawn
      ? { lifetimeWithdrawn: { increment: input.lifetime.withdrawn } }
      : {}),
    ...(input.lifetime?.tippedOut
      ? { lifetimeTippedOut: { increment: input.lifetime.tippedOut } }
      : {}),
  };

  if (delta < 0) {
    // 原子闸门：余额不足则一行都不改
    const res = await tx.coinAccount.updateMany({
      where: { userId: input.userId, balance: { gte: -delta } },
      data: {
        balance: { increment: delta },
        ...(frozenDelta ? { frozen: { increment: frozenDelta } } : {}),
        ...lifetimeData,
      },
    });
    if (res.count === 0) return null;
  } else {
    await tx.coinAccount.update({
      where: { userId: input.userId },
      data: {
        balance: { increment: delta },
        ...(frozenDelta ? { frozen: { increment: frozenDelta } } : {}),
        ...lifetimeData,
      },
    });
  }

  const after = await tx.coinAccount.findUniqueOrThrow({
    where: { userId: input.userId },
    select: { balance: true, frozen: true },
  });

  if (writeLedger) {
    // 余额已改，流水失败会让整个事务回滚（含余额自增）—— 幂等的关键
    await tx.coinLedger.create({
      data: {
        userId: input.userId,
        delta,
        kind: input.kind,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        balance: after.balance,
        note: input.note ?? null,
      },
    });
  }

  return after;
}

function tryTx(fn: (tx: CoinTx) => Promise<CoinApplied>): Promise<CoinApplied> {
  return prisma
    .$transaction(fn)
    .catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
      console.error("[coin] 记账失败", e);
      return null;
    });
}

// ---------- 对外写入口 ----------

/** 入账（结算入账 / 收到打赏 / 手工调整加）。返回 null = 未入账（已入过或失败） */
export function creditCoin(input: {
  userId: string;
  coin: number;
  kind: CoinReason;
  refType?: string;
  refId?: string | null;
  note?: string | null;
  /** 是否计入「累计获得」（结算/打赏为 true；管理员调整默认为 false） */
  countLifetime?: boolean;
}): Promise<CoinApplied> {
  if (input.coin <= 0) return Promise.resolve(null);
  return tryTx((tx) =>
    applyCoin(tx, {
      userId: input.userId,
      delta: input.coin,
      kind: input.kind,
      refType: input.refType,
      refId: input.refId,
      note: input.note,
      lifetime: input.countLifetime === false ? {} : { earned: input.coin },
    }),
  );
}

/** 出账（打赏出去 / 手工调整扣）。余额不足返回 null */
export function debitCoin(input: {
  userId: string;
  coin: number;
  kind: CoinReason;
  refType?: string;
  refId?: string | null;
  note?: string | null;
  countTippedOut?: boolean;
}): Promise<CoinApplied> {
  if (input.coin <= 0) return Promise.resolve(null);
  return tryTx((tx) =>
    applyCoin(tx, {
      userId: input.userId,
      delta: -input.coin,
      kind: input.kind,
      refType: input.refType,
      refId: input.refId,
      note: input.note,
      lifetime: input.countTippedOut ? { tippedOut: input.coin } : {},
    }),
  );
}

/** 提现冻结：可用 → 冻结（必须与「写 WithdrawalRequest」在同一个事务里） */
export function freezeForWithdrawal(
  tx: CoinTx,
  input: { userId: string; coin: number; withdrawalId: string },
): Promise<CoinApplied> {
  return applyCoin(tx, {
    userId: input.userId,
    delta: -input.coin,
    frozenDelta: input.coin,
    kind: "WITHDRAW_FREEZE",
    refType: "WITHDRAWAL",
    refId: input.withdrawalId,
    note: `提现申请冻结 ${input.coin} PIX`,
  });
}

/** 提现驳回：冻结 → 可用 */
export function refundWithdrawal(
  tx: CoinTx,
  input: { userId: string; coin: number; withdrawalId: string },
): Promise<CoinApplied> {
  return applyCoin(tx, {
    userId: input.userId,
    delta: input.coin,
    frozenDelta: -input.coin,
    kind: "WITHDRAW_REFUND",
    refType: "WITHDRAWAL",
    refId: input.withdrawalId,
    note: `提现驳回解冻 ${input.coin} PIX`,
  });
}

/**
 * 提现打款完成：只关门（frozen −N、累计提现 +N），**不写 PIX 流水**（见文件头说明）。
 * 现金出账由调用方写 `LedgerEntry(WITHDRAWAL_PAID, OUT)`。
 */
export function markWithdrawalPaid(
  tx: CoinTx,
  input: { userId: string; coin: number },
): Promise<CoinApplied> {
  return applyCoin(tx, {
    userId: input.userId,
    delta: 0,
    frozenDelta: -input.coin,
    kind: "WITHDRAW_PAID",
    refType: "WITHDRAWAL",
    refId: null, // 不写流水：refId 留空，避免产生一条 delta=0 的噪声行
    lifetime: { withdrawn: input.coin },
    writeLedger: false,
  });
}

// ---------- 读侧 ----------

export type CoinAccountView = {
  balance: number;
  frozen: number;
  lifetimeEarned: number;
  lifetimeWithdrawn: number;
  lifetimeTippedOut: number;
};

export async function getCoinAccount(userId: string): Promise<CoinAccountView> {
  const row = await prisma.coinAccount.findUnique({
    where: { userId },
    select: {
      balance: true,
      frozen: true,
      lifetimeEarned: true,
      lifetimeWithdrawn: true,
      lifetimeTippedOut: true,
    },
  });
  return (
    row ?? { balance: 0, frozen: 0, lifetimeEarned: 0, lifetimeWithdrawn: 0, lifetimeTippedOut: 0 }
  );
}

export type CoinLedgerRow = {
  id: string;
  delta: number;
  kind: CoinReason;
  balance: number;
  note: string | null;
  createdAt: Date;
};

export async function getCoinLedger(userId: string, take: number): Promise<CoinLedgerRow[]> {
  const rows = await prisma.coinLedger.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, delta: true, kind: true, balance: true, note: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, kind: r.kind as CoinReason }));
}

/** 全站 PIX 总量（= Σ余额 + Σ冻结）。打赏前后必须相同（打赏守恒的断言点） */
export async function totalCoinSupply(): Promise<number> {
  const agg = await prisma.coinAccount.aggregate({
    _sum: { balance: true, frozen: true },
  });
  return (agg._sum.balance ?? 0) + (agg._sum.frozen ?? 0);
}

// ============================ 偿付水位（单点实现） ============================
// 计划 §3.4 / §12：「水位数字与 /admin/withdrawals 顶部水位必须完全一致（复用同一函数，
// 不得各算一遍）」。所以 /fund、/admin/withdrawals、结算确认、提现申请**四处都调这里**。

export type Solvency = {
  /** 可用现金 C（分）= Σ收入 − Σ成本 − Σ已打款 */
  cashFen: number;
  /** 代币负债 L（分）= Σ(余额 + 冻结) 折算成分 */
  liabilityFen: number;
  /** 未打款提现合计（分）：PENDING + APPROVED */
  pendingWithdrawFen: number;
  /** 收入 / 成本 / 已打款 / 退款（分），页面明细用 */
  incomeFen: number;
  costFen: number;
  paidFen: number;
  refundFen: number;
  /** 兑换比例（PIX/元）与安全水位（万分比），来自配置 */
  perYuan: number;
  bufferPermille: number;
  /** 安全上限 = C × (1 − buffer)，按整数万分比取整 */
  safeLimitFen: number;
  /** 水位 = L / C（万分比）；C ≤ 0 且 L > 0 时给 PERMILLE_BASE（表示 100% 顶格） */
  usagePermille: number;
  /** 是否在安全水位内（L ≤ 安全上限） */
  ok: boolean;
};

export async function getSolvency(): Promise<Solvency> {
  const cfg = await getIncentive();
  const perYuan = cfg.coin.perYuan;

  const [sums, coinAgg, pendingAgg] = await Promise.all([
    ledgerSums(),
    prisma.coinAccount.aggregate({ _sum: { balance: true, frozen: true } }),
    prisma.withdrawalRequest.aggregate({
      where: { status: { in: ["PENDING", "APPROVED"] } },
      _sum: { fiatFen: true },
    }),
  ]);

  // 现金口径取自 ledger.ts（科目 → 方向的唯一实现），本文件不再写第二份 if 链
  const { incomeFen, costFen, paidFen, refundFen, cashFen } = sums;

  const coinSum = (coinAgg._sum.balance ?? 0) + (coinAgg._sum.frozen ?? 0);
  const liabilityFen = Math.floor((coinSum * FEN_PER_YUAN) / perYuan);
  const safeLimitFen = Math.floor(
    (cashFen * (PERMILLE_BASE - cfg.solvency.bufferPermille)) / PERMILLE_BASE,
  );
  const usagePermille =
    cashFen > 0
      ? Math.floor((liabilityFen * PERMILLE_BASE) / cashFen)
      : liabilityFen > 0
        ? PERMILLE_BASE
        : 0;

  return {
    cashFen,
    liabilityFen,
    pendingWithdrawFen: pendingAgg._sum.fiatFen ?? 0,
    incomeFen,
    costFen,
    paidFen,
    refundFen,
    perYuan,
    bufferPermille: cfg.solvency.bufferPermille,
    safeLimitFen,
    usagePermille,
    ok: liabilityFen <= safeLimitFen,
  };
}

/** 闸门一 · 结算确认：本次待入账金额加进去后仍在水位内 */
export function checkSettlementGate(
  s: Solvency,
  newLiabilityFen: number,
  strategy: "reject" | "scale",
): { ok: true } | { ok: false; message: string; allowScale: boolean } {
  if (s.liabilityFen + newLiabilityFen <= s.safeLimitFen) return { ok: true };
  return {
    ok: false,
    allowScale: strategy === "scale",
    message:
      `可用资金不足：本次需 ${yuanOf(newLiabilityFen)}，可用安全额度 ${yuanOf(s.safeLimitFen)}（` +
      `现金 ${yuanOf(s.cashFen)} − 现有 PIX 负债 ${yuanOf(s.liabilityFen)}）。` +
      `请核对收入是否已到账、是否漏录。`,
  };
}

/**
 * 闸门二 · 提现申请：`C ≥ Σ(未打款提现) + 本次申请`。
 * 刻意**不**再乘 buffer —— buffer 是「限制新增负债」用的，兑现已有 PIX 不该被它拦。
 */
export function checkWithdrawGate(
  s: Solvency,
  amountFen: number,
): { ok: true } | { ok: false; message: string } {
  const need = s.pendingWithdrawFen + amountFen;
  if (s.cashFen >= need) return { ok: true };
  return {
    ok: false,
    message: `当前资金不足以处理提现（可用 ${yuanOf(s.cashFen)}，待处理与本次合计 ${yuanOf(need)}），请稍后再试`,
  };
}

function yuanOf(fen: number): string {
  return `${(fen / 100).toFixed(2)} 元`;
}
