import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { auth } from "@/lib/auth";
import { getIncentive } from "@/lib/incentive";
import {
  getContributionSummary,
  getPointLogs,
  getPointRank,
  isSettleEligible,
  periodSince,
  type RankPeriod,
} from "@/lib/points";
import { pointReasonLabel } from "@/lib/points-config";
import LevelBadge from "@/components/ui/LevelBadge";
import { formatCount, timeAgo } from "@/lib/format";
import { prisma } from "@/lib/db/prisma";

export const metadata: Metadata = { title: "我的贡献", robots: { index: false } };

const PERIOD_LABELS: Record<RankPeriod, string> = { all: "总榜", month: "月榜", week: "周榜" };

export default async function MyContributionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/creators/me");
  const me = session.user.id;

  const cfg = await getIncentive();
  const [summary, logs, ranks] = await Promise.all([
    getContributionSummary(me),
    getPointLogs(me, 50),
    Promise.all(
      (["all", "month", "week"] as RankPeriod[]).map(async (p) => [p, await getPointRank(me, p)] as const),
    ),
  ]);

  const sortedLevels = [...cfg.levels].sort((a, b) => a.min - b.min);
  const enabledPeriods = (cfg.ranking.periods as RankPeriod[]).filter((p) => p !== "all");
  const since = periodSince("month");
  const monthPoints = since
    ? (
        await prisma.pointLog.aggregate({
          where: { userId: me, createdAt: { gte: since }, delta: { gt: 0 } },
          _sum: { delta: true },
        })
      )._sum.delta ?? 0
    : summary.points;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">我的贡献</h1>
          <p className="mt-1 text-sm text-neutral-500">
            贡献分只增不减，取消赞/取关不会回冲。等级只影响展示与排序。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/me/coins"
            className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-brand-700"
          >
            我的代币
          </Link>
          <Link
            href="/creators"
            className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-brand-700"
          >
            看榜单
          </Link>
        </div>
      </div>

      {/* 概览：当前分数 + 等级 + 距下一档进度 */}
      <section className="mt-5 rounded-none border border-brand-200 bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-3xl font-semibold tabular-nums text-brand-700">
            {formatCount(summary.points)}
          </span>
          <span className="text-xs text-neutral-500">贡献分</span>
          <LevelBadge level={summary.level} name={summary.levelName} size="md" />
          {summary.frozen && (
            <span className="rounded-none border border-red-300 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
              计分已冻结
            </span>
          )}
          <span className="ml-auto text-xs text-neutral-500">近 30 天 +{formatCount(monthPoints)}</span>
        </div>

        {summary.next ? (
          <>
            <div className="mt-3 flex items-center justify-between text-xs text-neutral-600">
              <span>
                距「{summary.next.name}」还差 {formatCount(summary.toNext)} 分
              </span>
              <span className="tabular-nums">{Math.round(summary.progress * 100)}%</span>
            </div>
            <div
              className="mt-1.5 h-2 w-full rounded-none bg-brand-100"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(summary.progress * 100)}
              aria-label="升级进度"
            >
              <div
                className="h-full rounded-none bg-brand-500"
                style={{ width: `${Math.round(summary.progress * 100)}%` }}
              />
            </div>
          </>
        ) : (
          <p className="mt-3 text-xs text-neutral-600">已达到最高等级。</p>
        )}

        {cfg.ranking.periods.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-brand-200 pt-3 text-xs text-neutral-600">
            {ranks.map(([p, r]) => (
              <span key={p}>
                {PERIOD_LABELS[p]}名次：
                {r ? (
                  <span className="font-medium tabular-nums text-brand-700">第 {r} 名</span>
                ) : (
                  <span className="text-neutral-400">未上榜</span>
                )}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 等级阶梯：门槛来自后台配置，「权益」这一列如实说明边界 */}
      <section className="mt-6">
        <h2 className="text-base font-medium text-neutral-900">等级阶梯</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          等级<strong className="font-medium">不含免审、不含任何功能特权</strong>
          —— 免审属于风控，只由人工授予，任何贡献分都换不到。
        </p>
        <div className="mt-3 overflow-hidden rounded-none border border-brand-200">
          <table className="w-full text-sm">
            <thead className="bg-brand-50/40 text-xs text-neutral-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">等级</th>
                <th className="px-3 py-2 text-right font-medium">所需贡献分</th>
                <th className="px-3 py-2 text-right font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {sortedLevels.map((lv, i) => {
                const reached = summary.points >= lv.min;
                const current = i === summary.level;
                return (
                  <tr
                    key={`${lv.name}-${lv.min}`}
                    className={`border-t border-brand-200 ${current ? "bg-brand-50/40" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <LevelBadge level={i} name={lv.name} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
                      {formatCount(lv.min)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {current ? (
                        <span className="text-brand-700">当前</span>
                      ) : reached ? (
                        <span className="inline-flex items-center gap-1 text-neutral-600">
                          <Check size={12} aria-hidden /> 已达成
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-neutral-400">
                          <Minus size={12} aria-hidden /> 未达成
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 贡献流水：标明每一项是否计入结算 */}
      <section className="mt-6">
        <h2 className="text-base font-medium text-neutral-900">贡献流水</h2>
        <p className="mt-1 text-xs text-neutral-500">
          「计入结算」的项参与激励池分配，「仅荣誉」只计等级与榜单。
        </p>
        {logs.length === 0 ? (
          <div className="mt-3 grid place-items-center rounded-none border-2 border-dashed border-brand-300 py-12 text-sm text-neutral-500">
            还没有贡献记录。发布内容通过审核后就会开始计分。
          </div>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-1">
            {logs.map((l) => (
              <li
                key={l.id}
                className="flex items-center gap-3 rounded-none border border-brand-200 bg-surface px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-neutral-700">
                  {pointReasonLabel(l.reason)}
                  {l.note && <span className="ml-2 text-xs text-neutral-500">{l.note}</span>}
                </span>
                <span
                  className={`shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] font-medium ${
                    isSettleEligible(cfg, l.reason)
                      ? "border-brand-300 text-brand-700"
                      : "border-neutral-300 text-neutral-500"
                  }`}
                >
                  {isSettleEligible(cfg, l.reason) ? "计入结算" : "仅荣誉"}
                </span>
                <span
                  className={`w-14 shrink-0 text-right text-sm font-medium tabular-nums ${
                    l.delta >= 0 ? "text-brand-700" : "text-red-600"
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
        {enabledPeriods.length > 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            月榜 / 周榜是滚动窗口（近 30 / 7 天），不是自然月。
          </p>
        )}
      </section>
    </div>
  );
}
