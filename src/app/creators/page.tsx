import Link from "next/link";
import type { Metadata } from "next";
import { Info } from "lucide-react";
import { getIncentive } from "@/lib/incentive";
import { getTopByPoints, type RankPeriod } from "@/lib/points";
import { levelNameOf, levelOf, permilleText } from "@/lib/points-config";
import { listPeriods, payoutCounts } from "@/lib/settle";
import { formatYuan } from "@/lib/money";
import PresenceAvatar from "@/components/ui/PresenceAvatar";
import LevelBadge from "@/components/ui/LevelBadge";
import { formatCount, dayKey } from "@/lib/format";

const PERIOD_LABELS: Record<RankPeriod, string> = { all: "总榜", month: "月榜", week: "周榜" };
const PERIOD_HINTS: Record<RankPeriod, string> = {
  all: "计入全部历史的贡献分",
  month: "仅统计最近 30 天获得的贡献分",
  week: "仅统计最近 7 天获得的贡献分",
};

export async function generateMetadata(): Promise<Metadata> {
  const cfg = await getIncentive();
  if (!cfg.enabled) return { title: "创作者榜", robots: { index: false } };
  return {
    title: "创作者榜",
    description:
      "按贡献分排列的创作者榜单。贡献分来自投稿、被收藏、被下载与被精选，只增不减；榜单只显示贡献分，不显示任何可兑换的数字。",
  };
}

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodRaw } = await searchParams;
  const cfg = await getIncentive();

  if (!cfg.enabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">创作者榜</h1>
        <div className="mt-6 grid place-items-center rounded-none border-2 border-dashed border-brand-300 py-16 text-sm text-neutral-500">
          激励体系当前未开启。
        </div>
      </div>
    );
  }

  const allowed = cfg.ranking.periods as RankPeriod[];
  const period: RankPeriod = allowed.includes(periodRaw as RankPeriod)
    ? (periodRaw as RankPeriod)
    : (allowed[0] ?? "all");
  const rows = await getTopByPoints(period, cfg.ranking.limit);

  // 激励公示：这里只给「池子 / 人数 / 合计」这一层的汇总，
  // **逐人分配明细只存在于 /fund 一处** —— 同一个数字在两个页面各写一份，
  // 迟早会出现两页对不上的情况（计划 §8：激励池 P 的展示口径必须唯一）。
  const periods = await listPeriods(6);
  const counts = await payoutCounts(periods.map((p) => p.id));

  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-none border px-3 py-1 text-xs transition ${
      active
        ? "border-brand-600 bg-brand-500 text-white"
        : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-500"
    }`;

  // 名次色：前三名给金色系强调，其余中性。颜色不单独承担信息 —— 名次数字本身就在。
  const rankCls = (i: number) =>
    i === 0
      ? "text-amber-700"
      : i === 1 || i === 2
        ? "text-brand-700"
        : "text-neutral-400";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">创作者榜</h1>
          <p className="mt-1 text-sm text-neutral-500">
            贡献分只来自投稿上架、被收藏、被下载与被精选，按「累计获得」计算，取关/取消赞不回冲。
          </p>
        </div>
        <Link
          href="/creators/me"
          className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-brand-700"
        >
          我的贡献
        </Link>
      </div>

      {allowed.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {allowed.map((p) => (
            <Link key={p} href={`/creators?period=${p}`} className={chip(period === p)}>
              {PERIOD_LABELS[p]}
            </Link>
          ))}
          <span className="text-xs text-neutral-500">{PERIOD_HINTS[period]}</span>
        </div>
      )}

      <div className="mt-4 flex items-start gap-1.5 rounded-none border border-brand-200 bg-brand-50/40 px-3 py-2 text-xs text-neutral-600">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          榜单只显示贡献分，不显示任何可兑换的数字 —— 荣誉榜不该变成财富榜。等级只影响展示与排序，
          <strong className="font-medium">不含免审、不含功能特权</strong>。
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 grid place-items-center rounded-none border-2 border-dashed border-brand-300 py-16 text-sm text-neutral-500">
          这个周期还没有人上榜。
        </div>
      ) : (
        <ol className="mt-6 grid grid-cols-1 gap-2">
          {rows.map((c, i) => (
            <li key={c.userId}>
              <Link
                href={`/u/${c.username}`}
                className="flex items-center gap-3 rounded-none border border-brand-200 bg-surface px-3 py-2.5 transition hover:border-brand-500"
              >
                <span
                  className={`w-8 shrink-0 text-center text-sm font-medium tabular-nums ${rankCls(i)}`}
                >
                  {i + 1}
                </span>
                <PresenceAvatar
                  userId={c.userId}
                  name={c.name}
                  username={c.username}
                  avatarKey={c.avatarKey}
                  size="md"
                  online={false}
                />
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-sm font-medium text-neutral-800">
                    {c.name ?? c.username}
                  </span>
                  <LevelBadge
                    level={levelOf(c.points, cfg.levels)}
                    name={levelNameOf(c.points, cfg.levels)}
                  />
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-brand-700">
                  {formatCount(c.points)}
                  <span className="ml-1 text-[11px] font-normal text-neutral-500">贡献分</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {/* 激励公示：汇总层在这里，逐人明细在 /fund（不重复展示同一个数字） */}
      <section id="settlements" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-neutral-900">激励公示</h2>
            <p className="mt-1 text-sm text-neutral-500">
              每期分成池的来源与去向：收入 × 分成比例 = 池子，再按贡献分权重分给达标创作者。
              逐人分配明细在资金公示页。
            </p>
          </div>
          <Link
            href="/fund#settlements"
            className="shrink-0 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-brand-700"
          >
            查看资金公示
          </Link>
        </div>

        {periods.length === 0 ? (
          <p className="mt-4 border border-dashed border-brand-300 px-4 py-8 text-center text-sm text-neutral-500">
            还没有已确认的结算期。收入按月归集，第一期待资金公示页确认后列出。
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-2">
            {periods.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border border-brand-200 bg-surface px-3 py-2.5 sm:px-4"
              >
                <span className="text-sm font-medium tabular-nums text-neutral-900">{p.periodKey}</span>
                <span className="text-[11px] tabular-nums text-neutral-500">
                  {formatYuan(p.revenueFen)} × {permilleText(p.ratePermille)} = 池子{" "}
                  <span className="text-neutral-700">{formatYuan(p.poolFen)}</span>
                </span>
                {p.carryInFen > 0 && (
                  <span className="text-[11px] text-neutral-400">
                    （含上期结转 {formatYuan(p.carryInFen)}）
                  </span>
                )}
                <span className="text-[11px] text-neutral-500">{counts.get(p.id) ?? 0} 人</span>
                <span className="text-[11px] tabular-nums text-neutral-500">
                  已发放 {formatYuan(p.paidFen)}
                </span>
                <span className="ml-auto flex items-center gap-2 text-[11px] text-neutral-400">
                  {p.confirmedAt && <span>确认于 {dayKey(p.confirmedAt)}</span>}
                  <span
                    className={
                      p.status === "PAID" ? "text-emerald-700" : "text-brand-700"
                    }
                  >
                    {p.status === "PAID" ? "已发放" : "已确认"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-neutral-500">
        激励结算不承诺固定金额：池子取决于当期实际到账收入，收入为 0 时池子为 0。
        {cfg.coin.name} 是站内代币，可提现，也可用于打赏喜欢的作品。
      </p>
    </div>
  );
}
