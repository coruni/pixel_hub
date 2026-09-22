// `/fund` 公开聚合只读层 —— **只读，不写任何账**。
//
// 铁律（计划 §8.1）：页面上每个数字都必须能追到一条记录
// （`LedgerEntry` / `IncentivePeriod` / `IncentivePayout` / `WithdrawalRequest` / `PaymentOrder`），
// 追不到的数字不许上页面。所以本文件不做任何「估算」或「按比例推算」，
// 每一块都是对既有表的直接聚合。
//
// 隐私边界：本文件**永不**返回 `WithdrawalRequest.accountInfo`、任何用户的个人余额、
// `epayKey` 或回调原文。`payRef` 只在此处截到后 4 位。
import { prisma } from "@/lib/db/prisma";
import { getSolvency, type Solvency } from "@/lib/coin";
import { ledgerCount, ledgerPeriods, listLedger, type LedgerRow } from "@/lib/ledger";
import { listPeriods, periodPayouts, type PeriodRow, type PayoutRow } from "@/lib/settle";
import { sponsorTotals, thanksWall, type ThanksRow } from "@/lib/payment";
import { getIncentive } from "@/lib/incentive";

export type FundTotals = {
  /** 累计收入（分） */
  incomeFen: number;
  /** 累计运营成本（分） */
  costFen: number;
  /** 累计打款给创作者（分） */
  paidFen: number;
  /** 当前持有 PIX 的人数（余额或冻结 > 0） */
  holders: number;
  /** 赞助累计笔数与净额 */
  sponsorCount: number;
  sponsorAmountFen: number;
  /** 台账总笔数 */
  ledgerEntries: number;
};

export type FundOverview = {
  solvency: Solvency;
  totals: FundTotals;
  /** 台账出现过的归属期（倒序） */
  periods: string[];
  /** 已公示的结算期 */
  settlements: PeriodRow[];
  /** 鸣谢墙 */
  thanks: ThanksRow[];
  /** 赞助入口是否可用（通道配好且开启） */
  sponsorReady: boolean;
  /** 公示配置（是否展开金额 / 是否显示安全线 / 是否允许匿名） */
  disclosure: {
    showAmounts: boolean;
    thanksShowAmount: boolean;
    allowAnonymous: boolean;
    showSafetyLine: boolean;
  };
};

/** 页面首屏所需的全部只读数据（一次并发取齐，避免瀑布查询） */
export async function getFundOverview(): Promise<FundOverview> {
  const cfg = await getIncentive();
  const [solvency, holders, sponsor, entries, periods, settlements, thanks] = await Promise.all([
    getSolvency(),
    prisma.coinAccount.count({ where: { OR: [{ balance: { gt: 0 } }, { frozen: { gt: 0 } }] } }),
    sponsorTotals(),
    ledgerCount(),
    ledgerPeriods(24),
    listPeriods(12),
    thanksWall(200),
  ]);

  return {
    solvency,
    totals: {
      incomeFen: solvency.incomeFen,
      costFen: solvency.costFen,
      paidFen: solvency.paidFen,
      holders,
      sponsorCount: sponsor.count,
      sponsorAmountFen: sponsor.amountFen,
      ledgerEntries: entries,
    },
    periods,
    settlements,
    thanks,
    sponsorReady: false, // 由页面用 payment.sponsorEnabled() 覆盖（保持本文件不依赖 payment-settings 的密钥路径）
    disclosure: {
      showAmounts: cfg.disclosure.showAmounts,
      thanksShowAmount: cfg.disclosure.thanksShowAmount,
      allowAnonymous: cfg.disclosure.allowAnonymous,
      showSafetyLine: cfg.disclosure.showSafetyLine,
    },
  };
}

export type LedgerPage = {
  periodKey: string;
  rows: LedgerRow[];
  nextCursor: string | null;
};

/** 某月台账分页（游标：同一 createdAt 多条时也不重不漏） */
export async function getLedgerPage(input: {
  periodKey: string;
  cursor?: string | null;
}): Promise<LedgerPage> {
  const cfg = await getIncentive();
  const take = cfg.disclosure.ledgerPageSize;
  const rows = await listLedger({
    periodKey: input.periodKey,
    take: take + 1,
    cursor: input.cursor ?? null,
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    periodKey: input.periodKey,
    rows: page,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export type SettlementDetail = {
  period: PeriodRow;
  payouts: PayoutRow[];
};

/** 结算期明细（含各人分配；公示用，只有名次/贡献分/PIX，不含任何身份信息之外的东西） */
export async function getSettlementDetails(periods: PeriodRow[]): Promise<SettlementDetail[]> {
  return Promise.all(
    periods.map(async (period) => ({ period, payouts: await periodPayouts(period.id) })),
  );
}

/** 提现打款流水（并入 /fund 区块 ②）：只给后 4 位流水号，用于让用户对得上自己的到账 */
export type PublicPayout = {
  id: string;
  coinAmount: number;
  fiatFen: number;
  paidAt: Date | null;
  payRefTail: string | null;
};

export async function recentPayouts(take = 20): Promise<PublicPayout[]> {
  const rows = await prisma.withdrawalRequest.findMany({
    where: { status: "PAID" },
    orderBy: { paidAt: "desc" },
    take,
    select: { id: true, coinAmount: true, fiatFen: true, paidAt: true, payRef: true },
  });
  return rows.map((r) => ({
    id: r.id,
    coinAmount: r.coinAmount,
    fiatFen: r.fiatFen,
    paidAt: r.paidAt,
    // 只保留后 4 位：足以让本人核对，又不至于把流水号当搜索键泄露他人信息
    payRefTail: r.payRef ? r.payRef.slice(-4) : null,
  }));
}
