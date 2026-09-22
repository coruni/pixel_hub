import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { ensureIncentive } from "@/lib/incentive";
import { monthKey } from "@/lib/format";
import { str, type SP } from "@/lib/search-params";
import { isPeriodKey } from "@/lib/settle-allocate";
import { buildDraft, listRevenue, settlementAnomalies } from "@/lib/settle";
import SettlementManager from "@/components/admin/SettlementManager";

export const metadata: Metadata = { title: "结算台" };

export default async function AdminSettlementPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  await ensureIncentive();

  const sp = await searchParams;
  const wanted = str(sp, "period") ?? "";
  const def = monthKey(new Date());
  const periodKey = isPeriodKey(wanted) ? wanted : def;

  const [draft, revenues, anomalies, periodRows] = await Promise.all([
    buildDraft(periodKey),
    listRevenue(periodKey),
    settlementAnomalies(periodKey),
    prisma.incentivePeriod.findMany({
      orderBy: { periodKey: "desc" },
      take: 24,
      select: { periodKey: true, status: true, poolFen: true, paidFen: true },
    }),
  ]);

  if (!draft) redirect("/admin/settlement");

  // 期列表：库里的期 + 当前查看期（台账里还没有任何记录的月份也要能点进来）
  const seen = new Set(periodRows.map((p) => p.periodKey));
  const periods = [
    ...(seen.has(periodKey)
      ? []
      : [{ periodKey, status: "DRAFT" as const, poolFen: 0, paidFen: 0 }]),
    ...periodRows.map((p) => ({
      periodKey: p.periodKey,
      status: p.status,
      poolFen: p.poolFen,
      paidFen: p.paidFen,
    })),
  ].sort((a, b) => (a.periodKey < b.periodKey ? 1 : -1));

  // userId → 展示名：预览明细里只有 userId，名字在服务端解析好再给客户端
  const ids = [
    ...new Set([
      ...draft.entries.map((e) => e.userId),
      ...draft.payouts.map((p) => p.userId),
    ]),
  ];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true, name: true },
      })
    : [];
  const names: Record<string, string> = {};
  for (const u of users) names[u.id] = u.name ?? u.username;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-medium text-neutral-900">结算台</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          录入已到账收入 → 按配置生成分配草稿 → 确认并向创作者入账代币。分成比例、分门槛、封顶与水位
          都在「创作者激励」配置页里改，这里只做执行与留痕。
        </p>
      </div>
      <SettlementManager
        draft={draft}
        revenues={revenues}
        anomalies={anomalies}
        periods={periods}
        names={names}
        today={today}
      />
    </div>
  );
}
