import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getIncentive } from "@/lib/incentive";
import { getCoinAccount, getCoinLedger } from "@/lib/coin";
import { getTipsReceived, getTipsSent } from "@/lib/tip";
import { coinReasonLabel } from "@/lib/points-config";
import { formatCoin, formatYuan } from "@/lib/money";
import { timeAgo } from "@/lib/format";
import WithdrawForm from "@/components/coins/WithdrawForm";

export const metadata: Metadata = { title: "我的代币", robots: { index: false } };

const WITHDRAW_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "待审核", cls: "border-amber-300 text-amber-700" },
  APPROVED: { label: "待打款", cls: "border-brand-300 text-brand-700" },
  PAID: { label: "已打款", cls: "border-emerald-300 text-emerald-700" },
  REJECTED: { label: "已驳回", cls: "border-neutral-300 text-neutral-500" },
};

export default async function MyCoinsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/me/coins");
  const me = session.user.id;

  const cfg = await getIncentive();
  const [account, ledger, tipsIn, tipsOut, withdrawals] = await Promise.all([
    getCoinAccount(me),
    getCoinLedger(me, 50),
    getTipsReceived(me, 20),
    getTipsSent(me, 20),
    prisma.withdrawalRequest.findMany({
      where: { userId: me },
      orderBy: { createdAt: "desc" },
      take: 20,
      // 注意：不 select accountInfo —— 收款信息连本人页面也不需要回显（避免截图外泄）
      select: {
        id: true,
        coinAmount: true,
        fiatFen: true,
        status: true,
        method: true,
        createdAt: true,
        paidAt: true,
        rejectNote: true,
        payRef: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">我的代币</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {cfg.coin.symbol} 由激励池按当期贡献分创造，不可购买、不可转让、不可赠送；
            打赏是站内转账，全站总量不因此改变。
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/creators/me"
            className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-brand-700"
          >
            我的贡献
          </Link>
          <Link
            href="/fund"
            className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-brand-700"
          >
            资金池公示
          </Link>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "可用", value: formatCoin(account.balance, cfg.coin.symbol), strong: true },
          { label: "提现处理中", value: formatCoin(account.frozen, cfg.coin.symbol) },
          { label: "累计获得", value: formatCoin(account.lifetimeEarned, cfg.coin.symbol) },
          { label: "累计提现", value: formatCoin(account.lifetimeWithdrawn, cfg.coin.symbol) },
          { label: "累计打赏出去", value: formatCoin(account.lifetimeTippedOut, cfg.coin.symbol) },
        ].map((item) => (
          <div key={item.label} className="border border-brand-200 bg-surface px-3 py-3">
            <dt className="text-[11px] text-neutral-500">{item.label}</dt>
            <dd
              className={`mt-1 text-base font-semibold tabular-nums ${
                item.strong ? "text-brand-700" : "text-neutral-900"
              }`}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* 提现入口 */}
      <div className="mt-6">
        {cfg.withdraw.enabled ? (
          <>
            <WithdrawForm
              minCoin={cfg.withdraw.minCoin}
              feeFen={cfg.withdraw.feeFen}
              cooldownDays={cfg.withdraw.cooldownDays}
              perYuan={cfg.coin.perYuan}
              symbol={cfg.coin.symbol}
              balance={account.balance}
              frozen={account.frozen}
            />
            <p className="mt-2 text-[11px] leading-4 text-neutral-400">
              冻结中的代币不能用于打赏，也不能再次提现。
            </p>
          </>
        ) : (
          <p className="border border-dashed border-brand-300 px-4 py-6 text-center text-sm text-neutral-500">
            提现功能当前未开放。已获得的代币仍然有效，随时可在上方看到余额。
          </p>
        )}
      </div>

      {/* 提现记录 */}
      {withdrawals.length > 0 && (
        <section className="mt-6">
          <h2 className="text-base font-medium text-neutral-900">提现记录</h2>
          <ul className="mt-3 grid grid-cols-1 gap-1">
            {withdrawals.map((w) => {
              const st = WITHDRAW_STATUS[w.status] ?? {
                label: w.status,
                cls: "border-neutral-300 text-neutral-500",
              };
              return (
                <li
                  key={w.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-brand-200 bg-surface px-3 py-2 text-sm"
                >
                  <span className="font-medium tabular-nums text-neutral-800">
                    {formatCoin(w.coinAmount, cfg.coin.symbol)}
                  </span>
                  <span className="text-xs tabular-nums text-neutral-500">
                    预计到账 {formatYuan(w.fiatFen)}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {w.method === "wechat" ? "微信" : "支付宝"}
                  </span>
                  <span
                    className={`rounded-none border px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}
                  >
                    {st.label}
                  </span>
                  {w.status === "PAID" && w.payRef && (
                    <span className="text-[11px] text-neutral-400">
                      流水号尾号 {w.payRef.slice(-4)}
                    </span>
                  )}
                  {w.rejectNote && (
                    <span className="text-[11px] text-red-600">原因：{w.rejectNote}</span>
                  )}
                  <span className="ml-auto text-[11px] text-neutral-400">
                    {timeAgo(w.paidAt ?? w.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 代币流水 */}
      <section className="mt-6">
        <h2 className="text-base font-medium text-neutral-900">代币流水</h2>
        {ledger.length === 0 ? (
          <div className="mt-3 grid place-items-center rounded-none border-2 border-dashed border-brand-300 py-12 text-sm text-neutral-500">
            还没有代币记录。每期激励结算确认后，按当期贡献分会自动入账。
          </div>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-1">
            {ledger.map((l) => (
              <li
                key={l.id}
                className="flex items-center gap-3 border border-brand-200 bg-surface px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-neutral-700">
                  {coinReasonLabel(l.kind)}
                  {l.note && <span className="ml-2 text-xs text-neutral-500">{l.note}</span>}
                </span>
                <span
                  className={`w-24 shrink-0 text-right text-sm font-medium tabular-nums ${
                    l.delta >= 0 ? "text-brand-700" : "text-neutral-600"
                  }`}
                >
                  {l.delta >= 0 ? "+" : ""}
                  {l.delta}
                </span>
                <span className="w-20 shrink-0 text-right text-xs text-neutral-500">
                  {timeAgo(l.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 打赏记录 */}
      {(tipsIn.length > 0 || tipsOut.length > 0) && (
        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          {[
            { title: "收到的打赏", rows: tipsIn, dir: "in" as const },
            { title: "发出的打赏", rows: tipsOut, dir: "out" as const },
          ].map((group) => (
            <div key={group.dir}>
              <h2 className="text-base font-medium text-neutral-900">{group.title}</h2>
              {group.rows.length === 0 ? (
                <p className="mt-3 border border-dashed border-brand-300 px-3 py-6 text-center text-xs text-neutral-500">
                  暂无记录
                </p>
              ) : (
                <ul className="mt-3 grid grid-cols-1 gap-1">
                  {group.rows.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border border-brand-200 bg-surface px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <Link
                          href={`/u/${t.counterparty.username}`}
                          className="text-neutral-700 hover:text-brand-700"
                        >
                          {t.counterparty.name ?? t.counterparty.username}
                        </Link>
                        {t.resourceTitle && (
                          <span className="ml-2 text-xs text-neutral-400">《{t.resourceTitle}》</span>
                        )}
                        {t.message && (
                          <span className="ml-2 text-xs text-neutral-500">「{t.message}」</span>
                        )}
                      </span>
                      <span
                        className={`shrink-0 text-sm font-medium tabular-nums ${
                          group.dir === "in" ? "text-brand-700" : "text-neutral-600"
                        }`}
                      >
                        {group.dir === "in" ? "+" : "−"}
                        {t.coin}
                      </span>
                      <span className="w-20 shrink-0 text-right text-xs text-neutral-500">
                        {timeAgo(t.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
