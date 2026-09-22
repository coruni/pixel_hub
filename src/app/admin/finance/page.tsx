import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getSolvency } from "@/lib/coin";
import { ledgerPeriods, listLedger } from "@/lib/ledger";
import { sponsorTotals } from "@/lib/payment";
import { ensureIncentive, getIncentive } from "@/lib/incentive";
import { monthKey } from "@/lib/format";
import { formatYuan } from "@/lib/money";
import { isPeriodKey } from "@/lib/settle-allocate";
import { str, type SP } from "@/lib/search-params";
import PoolMeter from "@/components/fund/PoolMeter";
import LedgerTable from "@/components/fund/LedgerTable";
import LedgerEntryForm from "@/components/admin/LedgerEntryForm";

export const metadata: Metadata = { title: "收支台账" };

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "in" | "out" | "brand";
}) {
  const color =
    tone === "in"
      ? "text-emerald-700"
      : tone === "out"
        ? "text-neutral-700"
        : tone === "brand"
          ? "text-brand-700"
          : "text-neutral-900";
  return (
    <div className="border border-brand-200 bg-surface px-3 py-2.5">
      <dt className="text-[11px] text-neutral-500">{label}</dt>
      <dd className={`mt-0.5 text-base font-semibold tabular-nums ${color}`}>{value}</dd>
      {hint && <p className="mt-0.5 text-[10px] leading-4 text-neutral-400">{hint}</p>}
    </div>
  );
}

export default async function AdminFinancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  await ensureIncentive();
  const cfg = await getIncentive();

  const sp = await searchParams;
  const wanted = str(sp, "period") ?? "";
  const now = monthKey(new Date());
  const periodKey = isPeriodKey(wanted) ? wanted : now;

  const [solvency, sponsor, holders, periods, rows, pendingOrders] = await Promise.all([
    getSolvency(),
    sponsorTotals(),
    prisma.coinAccount.count({ where: { OR: [{ balance: { gt: 0 } }, { frozen: { gt: 0 } }] } }),
    ledgerPeriods(24),
    listLedger({ periodKey, take: 200 }),
    prisma.paymentOrder.count({ where: { kind: "SPONSOR", status: "PENDING" } }),
  ]);

  const months = periods.includes(now) ? periods : [now, ...periods];
  const monthRows = rows;
  const monthIncome = monthRows.filter((r) => r.direction === "IN").reduce((s, r) => s + r.amountFen, 0);
  const monthOut = monthRows.filter((r) => r.direction === "OUT").reduce((s, r) => s + r.amountFen, 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">收支台账</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          站点账上每一笔真钱进出都在这里：收入到账、运营成本、创作者提现打款、赞助退款。
          确认结算向创作者入账代币**不在**这张表里 —— 那只是负债上升，钱还没出去，两件事混在一张表里账就永远对不平。
        </p>
      </div>

      <PoolMeter
        cashFen={solvency.cashFen}
        liabilityFen={solvency.liabilityFen}
        bufferPermille={solvency.bufferPermille}
        showSafetyLine={cfg.disclosure.showSafetyLine}
        perYuan={solvency.perYuan}
      />

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="累计收入" value={formatYuan(solvency.incomeFen)} tone="in" hint="含赞助与其他收入" />
        <Stat label="累计运营成本" value={formatYuan(solvency.costFen)} hint="服务器 / 存储 / 域名等" />
        <Stat
          label="累计创作者打款"
          value={formatYuan(solvency.paidFen)}
          hint={`折合 ${cfg.coin.symbol} 已提现部分`}
        />
        <Stat label="可用现金（C）" value={formatYuan(solvency.cashFen)} tone="brand" hint="收入 − 成本 − 打款 − 退款" />
        <Stat label="代币负债（L）" value={formatYuan(solvency.liabilityFen)} tone="out" hint="全部持有者余额 + 冻结" />
        <Stat label="安全额度" value={formatYuan(solvency.safeLimitFen)} hint={`水位 ${solvency.usagePermille / 100}%`} />
        <Stat label="持有代币的人数" value={`${holders} 人`} hint="余额或冻结大于 0" />
        <Stat
          label="赞助累计"
          value={`${sponsor.count} 笔 / ${formatYuan(sponsor.amountFen)}`}
          hint={pendingOrders > 0 ? `${pendingOrders} 笔订单待支付` : "已扣退款"}
        />
      </dl>

      <LedgerEntryForm defaultPeriodKey={periodKey} />

      <section className="border border-brand-200 bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-100 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-neutral-900">{periodKey} 明细</h3>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              本月收入 {formatYuan(monthIncome)}，支出 {formatYuan(monthOut)}，共 {monthRows.length} 笔。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {months.slice(0, 12).map((m) => (
              <Link
                key={m}
                href={`/admin/finance?period=${m}`}
                aria-current={m === periodKey ? "page" : undefined}
                className={`rounded-none border px-2 py-1 text-[11px] tabular-nums transition ${
                  m === periodKey
                    ? "border-brand-600 bg-brand-500 text-white"
                    : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-500"
                }`}
              >
                {m}
              </Link>
            ))}
          </div>
        </div>
        <div className="p-4">
          <LedgerTable rows={monthRows} showAmounts />
        </div>
      </section>

      <section className="border border-brand-200 bg-surface p-4">
        <h3 className="text-sm font-semibold text-neutral-900">相关操作</h3>
        <p className="mt-0.5 text-[11px] leading-4 text-neutral-500">
          记账是原料，结算与打款是下游。水位不足时结算会被闸门拒绝 —— 那是数据在说话，不是 bug。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/admin/settlement"
            className="inline-flex min-h-9 items-center gap-1 border border-brand-200 bg-surface px-3 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-brand-700"
          >
            去结算台
          </Link>
          <Link
            href="/admin/withdrawals"
            className="inline-flex min-h-9 items-center gap-1 border border-brand-200 bg-surface px-3 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-brand-700"
          >
            提现审核（{solvency.pendingWithdrawFen > 0 ? formatYuan(solvency.pendingWithdrawFen) : "无待打款"}）
          </Link>
          <Link
            href="/admin/payment"
            className="inline-flex min-h-9 items-center gap-1 border border-brand-200 bg-surface px-3 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-brand-700"
          >
            支付与赞助设置
          </Link>
          <Link
            href="/fund"
            className="inline-flex min-h-9 items-center gap-1 border border-brand-200 bg-surface px-3 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-brand-700"
          >
            查看公示页
          </Link>
        </div>
      </section>
    </div>
  );
}
