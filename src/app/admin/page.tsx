import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { dayKey } from "@/lib/format";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { siteOverviewOutputSchema } from "@/lib/ai/schema";
import SiteOverviewCard, {
  type SiteOverviewItemView,
  type SiteOverviewView,
} from "@/components/admin/SiteOverviewCard";

export const metadata: Metadata = { title: "管理概览" };

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

type OverviewTaskRow = Prisma.AiTaskGetPayload<{
  include: {
    suggestions: { orderBy: { createdAt: "desc" }; take: number };
    runs: { orderBy: { startedAt: "desc" }; take: number };
  };
}>;

/** 悬挂 RUNNING 阈值：>5 分钟视为后台任务已中断（进程重启等），页面访问时落库复位为 FAILED。 */
const STALE_RUNNING_MS = 5 * 60_000;

/** 把最近一条 SITE_OVERVIEW 任务整理成卡片可读形态：模型输出已按 Zod 校验，非法即 parseFailed。 */
function buildOverviewView(task: OverviewTaskRow): SiteOverviewView {
  let from: string | null = null;
  let to: string | null = null;
  try {
    const input = JSON.parse(task.inputJson) as { period?: { from?: string; to?: string } };
    from = input.period?.from ?? null;
    to = input.period?.to ?? null;
  } catch {
    /* 畸形输入不展示数据窗口 */
  }
  const raw = task.suggestions[0]?.outputJson ?? "";
  let summary = "";
  let insights: SiteOverviewItemView[] = [];
  let parseFailed = false;
  if (task.status === "SUCCEEDED" && raw) {
    try {
      const result = siteOverviewOutputSchema.safeParse(JSON.parse(raw));
      if (result.success) {
        summary = result.data.summary;
        insights = result.data.insights.map((item) => ({
          area: item.area,
          priority: item.priority,
          title: item.title,
          evidence: item.evidence ?? "",
          advice: item.advice,
        }));
      } else {
        parseFailed = true;
      }
    } catch {
      parseFailed = true;
    }
  }
  return {
    taskId: task.id,
    status: task.status,
    createdAt: task.createdAt.toISOString(),
    from,
    to,
    summary,
    parseFailed,
    insights,
  };
}

export default async function AdminIndex() {
  const [pending, reports, published, removed, users, openReports] = await Promise.all([
    prisma.resource.count({ where: { status: "PENDING" } }),
    prisma.resource.count({ where: { status: "REJECTED" } }),
    prisma.resource.count({ where: { status: "PUBLISHED" } }),
    prisma.resource.count({ where: { status: "REMOVED" } }),
    prisma.user.count(),
    prisma.report.count({ where: { status: "OPEN" } }),
  ]);

  // ---- 数据统计 ----
  const weekAgo = new Date();
  weekAgo.setHours(0, 0, 0, 0);
  weekAgo.setDate(weekAgo.getDate() - 6);

  const [
    resAgg,
    likeTotal,
    commentTotal,
    mediaTotal,
    mediaSize,
    tagTotal,
    categoryTotal,
    imageTotal,
    gameTotal,
    articleTotal,
    newUsers,
    trustedUsers,
    bannedUsers,
    followTotal,
    recentResources,
    recentUsers,
  ] = await Promise.all([
    prisma.resource.aggregate({ _sum: { viewCount: true, downloadCount: true, likeCount: true } }),
    prisma.like.count(),
    prisma.comment.count(),
    prisma.media.count(),
    prisma.media.aggregate({ _sum: { size: true } }),
    prisma.tag.count(),
    prisma.category.count(),
    prisma.resource.count({ where: { type: "IMAGE" } }),
    prisma.resource.count({ where: { type: "GAME" } }),
    prisma.resource.count({ where: { type: "ARTICLE" } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { trusted: true } }),
    prisma.user.count({ where: { bannedAt: { not: null } } }),
    prisma.follow.count(),
    // 近 7 日趋势原始数据（createdAt 列表，JS 分桶）
    prisma.resource.findMany({
      where: { createdAt: { gte: weekAgo } },
      select: { createdAt: true },
    }),
    prisma.user.findMany({
      where: { createdAt: { gte: weekAgo } },
      select: { createdAt: true },
    }),
  ]);

  // 按「本地日期」分桶，补齐没有数据的空天（key 与 Visit.day 同格式：YYYY-MM-DD）
  const days: {
    key: string;
    label: string;
    resources: number;
    users: number;
    pv: number;
    ips: number;
  }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({
      key: dayKey(d),
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      resources: 0,
      users: 0,
      pv: 0,
      ips: 0,
    });
  }
  const dayByKey = new Map(days.map((d) => [d.key, d]));
  for (const r of recentResources) {
    const day = dayByKey.get(dayKey(r.createdAt));
    if (day) day.resources++;
  }
  for (const u of recentUsers) {
    const day = dayByKey.get(dayKey(u.createdAt));
    if (day) day.users++;
  }
  const trendMax = Math.max(1, ...days.map((d) => Math.max(d.resources, d.users)));

  // ---- PV / IP 统计（Visit 表） ----
  const today = dayKey(new Date());
  const yesterdayD = new Date();
  yesterdayD.setDate(yesterdayD.getDate() - 1);
  const yesterday = dayKey(yesterdayD);
  const weekStart = days[0].key;

  const [todayPv, yesterdayPv, totalPv, weekRows, totalIpRow] = await Promise.all([
    prisma.visit.count({ where: { day: today } }),
    prisma.visit.count({ where: { day: yesterday } }),
    prisma.visit.count(),
    // 近 7 日按天聚合（PV = 行数，IP = 去重 ipHash）下推到 SQL，不把分组明细拉回 JS
    prisma.$queryRaw<Array<{ day: string; pv: number | bigint; ips: number | bigint }>>`
 SELECT day, COUNT(*) AS pv, COUNT(DISTINCT "ipHash") AS ips
 FROM "Visit"
 WHERE day >= ${weekStart}
 GROUP BY day`,
    // 累计独立 IP：DISTINCT 计数下推，避免全表 groupBy 拉回全部键
    prisma.$queryRaw<
      Array<{ ips: number | bigint }>
    >`SELECT COUNT(DISTINCT "ipHash") AS ips FROM "Visit"`,
  ]);
  const todayIps = Number(weekRows.find((r) => r.day === today)?.ips ?? 0);
  const yesterdayIps = Number(weekRows.find((r) => r.day === yesterday)?.ips ?? 0);
  const totalIps = Number(totalIpRow[0]?.ips ?? 0);
  for (const v of weekRows) {
    const day = dayByKey.get(v.day);
    if (day) {
      day.pv += Number(v.pv);
      day.ips += Number(v.ips);
    }
  }
  const visitMax = Math.max(1, ...days.map((d) => Math.max(d.pv, d.ips)));

  const stats = [
    { k: "总浏览量", v: (resAgg._sum.viewCount ?? 0).toLocaleString() },
    { k: "总下载量", v: (resAgg._sum.downloadCount ?? 0).toLocaleString() },
    { k: "点赞总数", v: likeTotal.toLocaleString() },
    { k: "评论总数", v: commentTotal.toLocaleString() },
    { k: "媒体文件", v: `${mediaTotal.toLocaleString()} 个` },
    { k: "存储占用", v: formatSize(mediaSize._sum.size) },
    { k: "标签", v: tagTotal.toLocaleString() },
    { k: "分类", v: categoryTotal.toLocaleString() },
    { k: "关注关系", v: followTotal.toLocaleString() },
    { k: "7 日新增用户", v: newUsers.toLocaleString() },
    { k: "trusted 用户", v: trustedUsers.toLocaleString() },
    { k: "封禁用户", v: bannedUsers.toLocaleString() },
    { k: "今日 PV", v: todayPv.toLocaleString() },
    { k: "今日 IP", v: todayIps.toLocaleString() },
    { k: "昨日 PV", v: yesterdayPv.toLocaleString() },
    { k: "昨日 IP", v: yesterdayIps.toLocaleString() },
    { k: "累计 PV", v: totalPv.toLocaleString() },
    { k: "累计 IP", v: totalIps.toLocaleString() },
  ];

  const cards = [
    { k: "待审核内容", v: pending, href: "/admin/queue", hl: pending > 0 },
    { k: "已上架内容", v: published, href: "/admin/content", hl: false },
    { k: "待处理举报", v: openReports, href: "/admin/reports", hl: openReports > 0 },
    { k: "注册用户", v: users, href: "/admin/users", hl: false },
    { k: "已下架", v: removed, href: "/admin/content?status=REMOVED", hl: false },
    { k: "已打回", v: reports, href: "/admin/content?status=REJECTED", hl: false },
  ];

  // ---- AI 运营建议：最近一条 SITE_OVERVIEW 任务（含模型输出） ----
  const overviewTask = await prisma.aiTask.findFirst({
    where: { kind: "SITE_OVERVIEW" },
    orderBy: { createdAt: "desc" },
    include: {
      suggestions: { orderBy: { createdAt: "desc" }, take: 1 },
      runs: { orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  // 悬挂 RUNNING 兜底：后台执行若因进程重启/异常中断，run 会残留 RUNNING 使按钮永远禁用。
  // 访问页面时若发现 RUNNING 超过阈值，落库置 FAILED（保留排查信息），让「重试生成」恢复可用。
  if (overviewTask?.status === "RUNNING") {
    const staleRun = overviewTask.runs[0];
    // RSC 数据获取期取服务器时钟判定 stale 窗口，不参与客户端渲染输出。
    // eslint-disable-next-line react-hooks/purity
    const staleMs = staleRun?.startedAt ? Date.now() - staleRun.startedAt.getTime() : Infinity;
    if (staleMs > STALE_RUNNING_MS) {
      await prisma.$transaction([
        prisma.aiRun.updateMany({
          where: { id: staleRun!.id, status: "RUNNING" },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            errorMessage: "后台任务中断（进程可能重启），已自动复位，可点击重试",
          },
        }),
        prisma.aiTask.updateMany({
          where: { id: overviewTask.id, status: "RUNNING" },
          data: { status: "FAILED" },
        }),
      ]);
      overviewTask.status = "FAILED";
    }
  }
  const overview = overviewTask ? buildOverviewView(overviewTask) : null;

  return (
    <div>
      <SiteOverviewCard view={overview} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Link
            key={c.k}
            href={c.href}
            className={`rounded-none border p-4 transition ${
              c.hl ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-surface"
            }`}
          >
            <div
              className={`text-2xl font-semibold ${c.hl ? "text-amber-700" : "text-neutral-900"}`}
            >
              {c.v}
            </div>
            <div className="mt-0.5 text-xs text-neutral-500">{c.k}</div>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.k} className="rounded-none border border-neutral-200 bg-surface p-4">
            <div className="text-xl font-semibold text-neutral-900">{s.v}</div>
            <div className="mt-0.5 text-xs text-neutral-500">{s.k}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        {/* 内容构成（按类型） */}
        <section className="rounded-none border border-neutral-200 bg-surface p-5">
          <h2 className="text-sm font-semibold text-neutral-900">内容构成</h2>
          <div className="mt-4 space-y-3">
            {[
              { k: "图片", v: imageTotal, cls: "bg-brand-500" },
              { k: "游戏", v: gameTotal, cls: "bg-emerald-500" },
              { k: "文章", v: articleTotal, cls: "bg-amber-500" },
            ].map((t) => {
              const total = imageTotal + gameTotal + articleTotal || 1;
              return (
                <div key={t.k} className="text-xs">
                  <div className="flex justify-between text-neutral-500">
                    <span>{t.k}</span>
                    <span>{t.v.toLocaleString()}</span>
                  </div>
                  <div className="mt-1 h-2 w-full border border-neutral-200 bg-neutral-100">
                    <div
                      className={`h-full ${t.cls}`}
                      style={{ width: `${Math.round((t.v / total) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 近 7 日趋势：新资源 / 新用户 */}
        <section className="rounded-none border border-neutral-200 bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">近 7 日趋势</h2>
            <div className="flex items-center gap-3 text-xs text-neutral-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 bg-brand-500" /> 新资源
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 bg-neutral-400" /> 新用户
              </span>
            </div>
          </div>
          <div className="mt-4 flex h-32 items-end gap-2">
            {days.map((d) => (
              <div
                key={d.key}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <div className="flex h-full w-full items-end justify-center gap-0.5">
                  <div
                    title={`新资源 ${d.resources}`}
                    className="w-2.5 bg-brand-500"
                    style={{
                      height: `${Math.max((d.resources / trendMax) * 100, d.resources > 0 ? 6 : 2)}%`,
                    }}
                  />
                  <div
                    title={`新用户 ${d.users}`}
                    className="w-2.5 bg-neutral-400"
                    style={{
                      height: `${Math.max((d.users / trendMax) * 100, d.users > 0 ? 6 : 2)}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] leading-none text-neutral-400">{d.label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 访问趋势：近 7 日 PV / IP */}
      <section className="mt-4 rounded-none border border-neutral-200 bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">访问趋势（近 7 日）</h2>
          <div className="flex items-center gap-3 text-xs text-neutral-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 bg-sky-500" /> PV
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 bg-brand-500" /> IP
            </span>
          </div>
        </div>
        <div className="mt-4 flex h-32 items-end gap-2">
          {days.map((d) => (
            <div key={d.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div className="flex h-full w-full items-end justify-center gap-0.5">
                <div
                  title={`PV ${d.pv}`}
                  className="w-3 bg-sky-500"
                  style={{ height: `${Math.max((d.pv / visitMax) * 100, d.pv > 0 ? 6 : 2)}%` }}
                />
                <div
                  title={`IP ${d.ips}`}
                  className="w-3 bg-brand-500"
                  style={{ height: `${Math.max((d.ips / visitMax) * 100, d.ips > 0 ? 6 : 2)}%` }}
                />
              </div>
              <span className="text-[10px] leading-none text-neutral-400">{d.label}</span>
            </div>
          ))}
        </div>
      </section>

      {pending > 0 && (
        <div className="mt-6 rounded-none border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-700">
          有 <b>{pending}</b> 条内容等待审核，
          <Link href="/admin/queue" className="underline">
            前往队列 →
          </Link>
        </div>
      )}
      {openReports > 0 && (
        <div className="mt-3 rounded-none border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          有 <b>{openReports}</b> 条举报待处理，
          <Link href="/admin/reports" className="underline">
            前往处理 →
          </Link>
        </div>
      )}
      {pending === 0 && openReports === 0 && (
        <p className="mt-6 rounded-none border border-brand-200 bg-surface px-5 py-4 text-sm text-neutral-500">
          一切正常，暂无待办事项 ✨
        </p>
      )}
    </div>
  );
}
