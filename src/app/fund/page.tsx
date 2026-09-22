import Link from "next/link";
import type { Metadata } from "next";
import { Info } from "lucide-react";
import { auth } from "@/lib/auth";
import { getIncentive } from "@/lib/incentive";
import { getPublicPaymentConfig } from "@/lib/payment-settings";
import { getFundOverview, getLedgerPage, getSettlementDetails, recentPayouts } from "@/lib/fund";
import { monthKey, formatCount } from "@/lib/format";
import { formatYuan } from "@/lib/money";
import PoolMeter from "@/components/fund/PoolMeter";
import LedgerTable from "@/components/fund/LedgerTable";
import SettlementList from "@/components/fund/SettlementList";
import ThanksWall from "@/components/fund/ThanksWall";
import SponsorForm from "@/components/fund/SponsorForm";

// 数值允许 5 分钟延迟（计划 §8.1）：不为实时性把 DB 打满。
// Next 的 revalidate 必须是字面量，所以这里写死 300；它对应 `disclosure.cacheSeconds` 的默认值。
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "资金池与收支公示",
    description:
      "本站的钱从哪来、到哪去：可用资金与代币负债水位、逐月收支明细、各期激励结算公示、赞助入口与鸣谢墙。每个数字都能追到一条记录。",
  };
}

const PERIOD_RE = /^\d{4}-\d{2}$/;

export default async function FundPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; pay_error?: string }>;
}) {
  const { m, pay_error } = await searchParams;
  const cfg = await getIncentive();
  const [overview, publicCfg] = await Promise.all([getFundOverview(), getPublicPaymentConfig()]);

  const current = monthKey(new Date());
  const monthKeyParam = m && PERIOD_RE.test(m) ? m : (overview.periods[0] ?? current);
  const [ledger, payoutRows, settlements, session] = await Promise.all([
    getLedgerPage({ periodKey: monthKeyParam }),
    recentPayouts(20),
    getSettlementDetails(overview.settlements),
    auth(),
  ]);

  const months = overview.periods.includes(monthKeyParam)
    ? overview.periods
    : [monthKeyParam, ...overview.periods];

  // 提现打款流水并入区块 ②（只显示后 4 位流水号，够本人核对，不泄露他人信息）
  const ledgerWithPayouts = [
    ...ledger.rows,
    ...payoutRows
      .filter((p) => (p.paidAt ? monthKey(p.paidAt) === monthKeyParam : false))
      .map((p) => ({
        id: p.id,
        periodKey: monthKeyParam,
        kind: "WITHDRAWAL_PAID" as const,
        direction: "OUT",
        amountFen: p.fiatFen,
        note: `流水号尾号 ${p.payRefTail ?? "—"} · ${p.coinAmount} ${cfg.coin.symbol}`,
        createdAt: p.paidAt ?? new Date(),
      })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          资金池与收支公示
        </h1>
        <p className="mt-1 text-sm leading-6 text-neutral-500">
          公益站的信任不是靠一页「关于我们」建立的，是靠每一笔收支都能被外人核对建立的。
          本页所有数字都来自台账与结算记录，没有一个是估算出来的。
        </p>
      </div>

      <div className="mt-6 space-y-6">
        {/* ① 水位 */}
        <PoolMeter
          cashFen={overview.solvency.cashFen}
          liabilityFen={overview.solvency.liabilityFen}
          bufferPermille={overview.solvency.bufferPermille}
          perYuan={overview.solvency.perYuan}
          showSafetyLine={overview.disclosure.showSafetyLine}
        />

        {/* ⑥ 累计数字条 */}
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "累计收入", value: formatYuan(overview.totals.incomeFen) },
            { label: "累计打款给创作者", value: formatYuan(overview.totals.paidFen) },
            { label: "累计运营成本", value: formatYuan(overview.totals.costFen) },
            { label: "持有代币的人数", value: `${formatCount(overview.totals.holders)} 人` },
          ].map((item) => (
            <div key={item.label} className="border border-brand-200 bg-surface px-3 py-3">
              <dt className="text-[11px] text-neutral-500">{item.label}</dt>
              <dd className="mt-1 text-base font-semibold tabular-nums text-neutral-900">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        {/* ② 本月收支明细 */}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">收支明细</h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                收入、成本与创作者提现打款逐笔列出，可按月切换。
              </p>
            </div>
            {months.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {months.slice(0, 12).map((key) => (
                  <Link
                    key={key}
                    href={`/fund?m=${key}`}
                    className={`rounded-none border px-2.5 py-1 text-xs tabular-nums transition ${
                      key === monthKeyParam
                        ? "border-brand-600 bg-brand-500 text-white"
                        : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-500"
                    }`}
                  >
                    {key}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3">
            <LedgerTable
              rows={ledgerWithPayouts}
              showAmounts={overview.disclosure.showAmounts}
            />
          </div>
          {overview.totals.ledgerEntries > ledger.rows.length && (
            <p className="mt-2 text-[11px] text-neutral-400">
              共 {overview.totals.ledgerEntries} 笔记录，此处显示当前月份。
            </p>
          )}
        </section>

        {/* ③ 各期激励结算公示 */}
        <section id="settlements" className="scroll-mt-20">
          <h2 className="text-sm font-semibold text-neutral-900">各期激励结算公示</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            每期「收入 × 分成比例 = 池子」，再按当期贡献分分配。确认后金额与名次即锁定，
            不提供任何编辑入口 —— 已公示的数字必须永远可复算。
          </p>
          <div className="mt-3">
            <SettlementList blocks={settlements} symbol={cfg.coin.symbol} />
          </div>
        </section>

        {/* ④ 赞助入口 */}
        <section id="sponsor" className="scroll-mt-20">
          <div className="flex flex-wrap items-start gap-1.5 rounded-none border border-brand-200 bg-brand-50/40 px-3 py-2 text-xs text-neutral-600">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              赞助只影响上面这些数字（收入与水位），
              <strong className="font-medium">不影响任何人的贡献分、等级或代币余额</strong>
              —— 花钱买不到地位，这是本站的底线。
            </span>
          </div>
          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <SponsorForm
              tiers={publicCfg.sponsor.tiers}
              minFen={publicCfg.sponsor.minFen}
              maxFen={publicCfg.sponsor.maxFen}
              allowAnonymous={publicCfg.sponsor.allowAnonymous}
              allowGuest={publicCfg.sponsor.allowGuest}
              messageMax={publicCfg.sponsor.messageMax}
              channels={publicCfg.channels}
              ready={publicCfg.ready}
              loggedIn={!!session?.user}
              error={pay_error ? String(pay_error).slice(0, 200) : null}
            />

            <div className="border border-brand-200 bg-surface p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-neutral-900">为什么需要钱</h2>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-neutral-600">
                <li>
                  · <strong className="font-medium text-neutral-800">服务器</strong>
                  ：站点与接口的常驻开销，按月计。
                </li>
                <li>
                  · <strong className="font-medium text-neutral-800">存储 / 流量</strong>
                  ：资源文件与图片的实际占用，随内容增长。
                </li>
                <li>
                  · <strong className="font-medium text-neutral-800">域名 / 证书</strong>
                  ：按年计，金额固定。
                </li>
              </ul>
              <p className="mt-3 text-[11px] leading-4 text-neutral-400">
                每一项的实际支出都逐笔记在「成本」里。收入不足时，创作者结算会被偿付闸门暂缓，
                而不是靠压缩内容或加广告硬撑。
              </p>
            </div>
          </div>
        </section>

        {/* ⑤ 鸣谢墙 */}
        <section id="thanks" className="scroll-mt-20">
          <h2 className="text-sm font-semibold text-neutral-900">鸣谢墙</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            按月列出赞助者与月度合计。匿名赞助在这里统一显示为「一位路过的朋友」。
          </p>
          <div className="mt-3">
            <ThanksWall rows={overview.thanks} showAmount={overview.disclosure.thanksShowAmount} />
          </div>
        </section>

        <p className="border border-brand-200 bg-surface px-3 py-3 text-[11px] leading-5 text-neutral-500">
          本页只显示聚合数字，不显示任何人的个人余额、收款信息或密钥。
          提现流水号仅显示后 4 位，便于本人核对到账。<br />
          代币不可购买、不可转让、不可赠送，只由激励池按当期贡献分创造；
          打赏是站内代币转账，全站代币总量不因此改变。
        </p>
      </div>
    </div>
  );
}
