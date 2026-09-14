import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { dayKey } from "@/lib/format";
import { BarList, StackedBar } from "@/components/admin/charts";
import { LineArea } from "@/components/admin/chart-line";
import type { Metadata } from "next";

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

/** 今日对昨日的环比：昨日为 0 时不给百分比（避免除零与「暴涨 100%」式伪增长） */
function trend(today: number, prev: number): { icon: "up" | "down" | null; text: string } | null {
  if (prev === 0) return today > 0 ? { icon: "up", text: "较昨日 新增" } : null;
  const pct = Math.round(((today - prev) / prev) * 100);
  if (pct === 0) return { icon: null, text: "较昨日 持平" };
  return { icon: pct > 0 ? "up" : "down", text: `较昨日 ${Math.abs(pct)}%` };
}

/** 概览分组卡片外壳：统一标题层级与内距 */
function Panel({
  title,
  note,
  className = "",
  children,
}: {
  title: string;
  note?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-none border border-neutral-200 bg-surface p-5 ${className}`}
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {note && <span className="text-xs text-neutral-400">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export default async function AdminIndex() {
  const [pending, reports, published, removed, draft, users, openReports] = await Promise.all([
    prisma.resource.count({ where: { status: "PENDING" } }),
    prisma.resource.count({ where: { status: "REJECTED" } }),
    prisma.resource.count({ where: { status: "PUBLISHED" } }),
    prisma.resource.count({ where: { status: "REMOVED" } }),
    prisma.resource.count({ where: { status: "DRAFT" } }),
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
    musicTotal,
    videoTotal,
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
    prisma.resource.count({ where: { type: "MUSIC" } }),
    prisma.resource.count({ where: { type: "VIDEO" } }),
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

  const labels = days.map((d) => d.label);
  const notTrusted = Math.max(0, users - trustedUsers);

  const cards = [
    { k: "待审核内容", v: pending, href: "/admin/queue", hl: pending > 0 },
    { k: "已上架内容", v: published, href: "/admin/content", hl: false },
    { k: "待处理举报", v: openReports, href: "/admin/reports", hl: openReports > 0 },
    { k: "注册用户", v: users, href: "/admin/users", hl: false },
    { k: "已下架", v: removed, href: "/admin/content?status=REMOVED", hl: false },
    { k: "已打回", v: reports, href: "/admin/content?status=REJECTED", hl: false },
  ];

  const visits = [
    { k: "今日", pv: todayPv, ips: todayIps, t: trend(todayPv, yesterdayPv) },
    { k: "昨日", pv: yesterdayPv, ips: yesterdayIps, t: null },
    { k: "累计", pv: totalPv, ips: totalIps, t: null },
  ];

  return (
    <div>
      {/* ---- 待办入口 ---- */}
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
              className={`text-2xl font-semibold tabular-nums ${
                c.hl ? "text-amber-700" : "text-neutral-900"
              }`}
            >
              {c.v}
            </div>
            <div className="mt-0.5 text-xs text-neutral-500">{c.k}</div>
          </Link>
        ))}
      </div>

      {/* ---- 分组指标：4 张卡替代原先平铺的 18 个统计块 ---- */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Panel title="内容与互动" note="累计">
          <BarList
            items={[
              { label: "总浏览量", value: resAgg._sum.viewCount ?? 0, tone: "brand" },
              { label: "总下载量", value: resAgg._sum.downloadCount ?? 0, tone: "sky" },
              { label: "点赞总数", value: likeTotal, tone: "emerald" },
              { label: "评论总数", value: commentTotal, tone: "amber" },
            ]}
          />
        </Panel>

        <Panel title="用户" note={`近 7 日 +${newUsers.toLocaleString()}`}>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-neutral-900">
              {users.toLocaleString()}
            </span>
            <span className="text-xs text-neutral-400">注册用户</span>
          </div>
          <div className="mt-4">
            <StackedBar
              title="免审构成"
              items={[
                { label: "免审", value: trustedUsers, tone: "emerald" },
                { label: "未免审", value: notTrusted, tone: "neutral" },
              ]}
            />
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            已封禁{" "}
            <span className={`font-medium ${bannedUsers > 0 ? "text-red-600" : "text-neutral-900"}`}>
              {bannedUsers.toLocaleString()}
            </span>
            <span className="text-neutral-400">（可与免审重叠，未计入上方占比）</span>
          </p>
        </Panel>

        <Panel title="站点资产">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {[
              { k: "媒体文件", v: `${mediaTotal.toLocaleString()} 个` },
              { k: "存储占用", v: formatSize(mediaSize._sum.size) },
              { k: "标签", v: tagTotal.toLocaleString() },
              { k: "分类", v: categoryTotal.toLocaleString() },
              { k: "关注关系", v: followTotal.toLocaleString() },
            ].map((s) => (
              <div key={s.k} className="min-w-0">
                <dt className="truncate text-xs text-neutral-500">{s.k}</dt>
                <dd className="mt-0.5 truncate text-lg font-semibold tabular-nums text-neutral-900">
                  {s.v}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title="访问概览" note="PV / IP">
          <div className="grid grid-cols-3 gap-3">
            {visits.map((v) => (
              <div key={v.k} className="min-w-0">
                <div className="text-xs text-neutral-400">{v.k}</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-lg font-semibold tabular-nums text-neutral-900">
                    {v.pv.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-neutral-400">PV</span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-sm tabular-nums text-neutral-700">
                    {v.ips.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-neutral-400">IP</span>
                </div>
                {v.t && (
                  <div className="mt-1.5 flex items-center gap-0.5 text-[10px] text-neutral-500">
                    {v.t.icon === "up" && <ArrowUp size={10} aria-hidden />}
                    {v.t.icon === "down" && <ArrowDown size={10} aria-hidden />}
                    {v.t.text}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* ---- 趋势与构成 ---- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="近 7 日新增" note="新资源 / 新用户">
          <LineArea
            title="近 7 日新增趋势"
            labels={labels}
            lines={[
              { label: "新资源", values: days.map((d) => d.resources), tone: "brand" },
              { label: "新用户", values: days.map((d) => d.users), tone: "neutral" },
            ]}
          />
        </Panel>

        <Panel title="内容构成" note="按类型 / 按状态">
          <StackedBar
            title="按类型"
            items={[
              { label: "图片", value: imageTotal, tone: "brand" },
              { label: "游戏", value: gameTotal, tone: "emerald" },
              { label: "文章", value: articleTotal, tone: "amber" },
              { label: "音乐", value: musicTotal, tone: "sky" },
              { label: "视频", value: videoTotal, tone: "red" },
            ]}
          />
          <div className="mt-5">
            <StackedBar
              title="按状态"
              items={[
                { label: "已上架", value: published, tone: "emerald" },
                { label: "待审核", value: pending, tone: "amber" },
                { label: "已打回", value: reports, tone: "red" },
                { label: "已下架", value: removed, tone: "neutral" },
                { label: "草稿", value: draft, tone: "brand" },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel title="访问趋势" note="近 7 日 PV / IP" className="mt-4">
        <LineArea
          title="访问趋势"
          labels={labels}
          lines={[
            { label: "PV", values: days.map((d) => d.pv), tone: "sky" },
            { label: "IP", values: days.map((d) => d.ips), tone: "brand" },
          ]}
        />
      </Panel>

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
