import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getSolvency } from "@/lib/coin";
import { ensureIncentive, getIncentive } from "@/lib/incentive";
import { formatYuan } from "@/lib/money";
import PoolMeter from "@/components/fund/PoolMeter";
import WithdrawalQueue, { type QueueRow } from "@/components/admin/WithdrawalQueue";

export const metadata: Metadata = { title: "提现审核" };

export default async function AdminWithdrawalsPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  await ensureIncentive();
  const cfg = await getIncentive();

  const [solvency, rows] = await Promise.all([
    getSolvency(),
    prisma.withdrawalRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: { select: { username: true, name: true } } },
    }),
  ]);

  const all: QueueRow[] = rows.map((r) => ({
    id: r.id,
    username: r.user.username,
    displayName: r.user.name,
    coinAmount: r.coinAmount,
    fiatFen: r.fiatFen,
    feeFen: r.feeFen,
    rateSnapshot: r.rateSnapshot,
    method: r.method,
    accountInfo: r.accountInfo,
    status: r.status,
    createdAt: r.createdAt,
    handledAt: r.handledAt,
    paidAt: r.paidAt,
    payRef: r.payRef,
    rejectNote: r.rejectNote,
  }));

  // 待处理按「先来先处理」正序，历史按时间倒序
  const pending = all.filter((r) => r.status === "PENDING").reverse();
  const approved = all.filter((r) => r.status === "APPROVED").reverse();
  const history = all.filter((r) => r.status === "PAID" || r.status === "REJECTED");
  const openCount = pending.length + approved.length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">提现审核</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          通过 → 线下打款 → 回填流水号。系统绝不自动打款：{cfg.withdraw.manualReview
            ? "当前要求人工审核。"
            : "当前已关闭人工审核，申请提交后直接进入「待打款」，但仍需人工转出。"}
          {" "}提现门槛 {cfg.withdraw.minCoin} {cfg.coin.symbol}，冷却 {cfg.withdraw.cooldownDays} 天。
        </p>
      </div>

      <PoolMeter
        cashFen={solvency.cashFen}
        liabilityFen={solvency.liabilityFen}
        bufferPermille={solvency.bufferPermille}
        showSafetyLine={cfg.disclosure.showSafetyLine}
        perYuan={solvency.perYuan}
      />

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="border border-brand-200 bg-surface px-3 py-2.5">
          <dt className="text-[11px] text-neutral-500">待处理申请</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-neutral-900">{openCount} 笔</dd>
        </div>
        <div className="border border-brand-200 bg-surface px-3 py-2.5">
          <dt className="text-[11px] text-neutral-500">待打款金额</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-neutral-900">
            {formatYuan(solvency.pendingWithdrawFen)}
          </dd>
        </div>
        <div className="border border-brand-200 bg-surface px-3 py-2.5">
          <dt className="text-[11px] text-neutral-500">可用资金</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-neutral-900">
            {formatYuan(solvency.cashFen)}
          </dd>
          <p className="mt-0.5 text-[10px] leading-4 text-neutral-400">
            打款会减少可用资金；提现申请时刻已按「可用 ≥ 待打款 + 本次」拦过一次。
          </p>
        </div>
      </dl>

      <WithdrawalQueue pending={pending} approved={approved} history={history} />
    </div>
  );
}
