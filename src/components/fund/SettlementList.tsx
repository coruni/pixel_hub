// 各期激励结算公示（服务端组件）。
//
// 每期一行：`收入 × 分成比例 = 池子` → 参与人数 → 分配明细。已确认期**不提供任何编辑入口**
// —— 已公示的数字必须永远可复算，所以它只能被读。
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatCoin, formatYuan } from "@/lib/money";
import { permilleText } from "@/lib/points-config";
import type { PayoutRow, PeriodRow } from "@/lib/settle";
import { dayKey } from "@/lib/format";

export type SettlementBlock = { period: PeriodRow; payouts: PayoutRow[] };

export default function SettlementList({
  blocks,
  symbol,
}: {
  blocks: SettlementBlock[];
  symbol: string;
}) {
  if (blocks.length === 0) {
    return (
      <p className="border border-dashed border-brand-300 px-4 py-8 text-center text-sm text-neutral-500">
        第一期结算将在下月初公示。收入按月归集，确认后这里会列出每一期的分配明细。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {blocks.map(({ period, payouts }) => (
        <details key={period.id} className="group border border-brand-200 bg-surface">
          <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-3 text-sm [&::-webkit-details-marker]:hidden sm:px-4">
            <ChevronRight
              size={14}
              aria-hidden
              className="shrink-0 self-center text-neutral-400 transition group-open:rotate-90"
            />
            <span className="font-medium text-neutral-900">{period.periodKey}</span>
            <span className="text-[11px] tabular-nums text-neutral-500">
              收入 {formatYuan(period.revenueFen)} × {permilleText(period.ratePermille)} =
              池子 {formatYuan(period.poolFen)}
            </span>
            {period.carryInFen > 0 && (
              <span className="text-[11px] text-neutral-500">
                （含上期结转 {formatYuan(period.carryInFen)}，结转不参与分成）
              </span>
            )}
            <span className="text-[11px] text-neutral-500">{payouts.length} 人</span>
            <span className="ml-auto text-[11px] text-neutral-400">
              {period.confirmedAt ? `确认于 ${dayKey(period.confirmedAt)}` : ""}
            </span>
          </summary>

          <div className="border-t border-brand-100 px-3 py-3 sm:px-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <dt className="text-[11px] text-neutral-500">已发放</dt>
                <dd className="text-sm tabular-nums text-neutral-800">
                  {formatYuan(period.paidFen)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-neutral-500">结转下期</dt>
                <dd className="text-sm tabular-nums text-neutral-800">
                  {formatYuan(period.carryOutFen)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-neutral-500">参与总分</dt>
                <dd className="text-sm tabular-nums text-neutral-800">{period.totalScore}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-neutral-500">状态</dt>
                <dd className="text-sm text-neutral-800">
                  {period.status === "PAID" ? "已发放" : "已确认"}
                </dd>
              </div>
            </dl>

            {payouts.length === 0 ? (
              <p className="mt-3 text-xs text-neutral-500">本期没有达到发放门槛的创作者。</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[26rem] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-brand-100 text-left text-[11px] text-neutral-500">
                      <th scope="col" className="py-1.5 pr-3 font-normal">
                        名次
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-normal">
                        创作者
                      </th>
                      <th scope="col" className="py-1.5 pr-3 text-right font-normal">
                        贡献分
                      </th>
                      <th scope="col" className="py-1.5 text-right font-normal">
                        获得
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((p) => (
                      <tr key={p.userId} className="border-b border-brand-100/70 last:border-0">
                        <td className="py-1.5 pr-3 tabular-nums text-neutral-400">{p.rank}</td>
                        <td className="min-w-0 py-1.5 pr-3">
                          <Link
                            href={`/u/${p.username}`}
                            className="truncate text-neutral-700 hover:text-brand-700"
                          >
                            {p.name ?? p.username}
                          </Link>
                          {p.capped && (
                            <span className="ml-2 text-[10px] text-amber-700">已封顶</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-600">
                          {p.score}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-neutral-800">
                          {formatCoin(p.coin, symbol)}
                          <span className="ml-1.5 text-[10px] text-neutral-400">
                            {formatYuan(p.amountFen)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
