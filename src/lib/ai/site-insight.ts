// site.overview 任务的数据采样：最近 7 个自然日的访客浏览聚合。
// 只落聚合数值与规范化路径（资源 slug / Top 页面），绝不把 ipHash、查询串或用户隐私放进快照。
import { prisma } from "@/lib/db/prisma";
import { dayKey } from "@/lib/format";

/** 采样窗口：最近 7 个自然日（含今天，day >= from；与概览页「近 7 日」口径一致）。 */
export function siteOverviewCycleDays(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from: dayKey(from), to: dayKey(to) };
}

/** 同周期幂等键：固定为窗口起始日，避免同日重复点击堆任务。 */
export function siteOverviewIdempotencyKey(fromDay: string): string {
  return `site-overview:${fromDay}:v1`;
}

const RESOURCE_PREFIX = "/resources/";
// 非资源页面的白名单前缀（其余路径不纳入建议输入）；主页为精确匹配 "/"。
const PAGE_PREFIXES = ["/", "/search", "/browse", "/tags/", "/categories", "/collections/", "/u/"];

/** 从访问路径解析资源详情 slug；非 /resources/{slug} 形态返回 null。 */
export function resourceSlugOf(path: string): string | null {
  const clean = (path ?? "").split("?")[0];
  if (!clean.startsWith(RESOURCE_PREFIX)) return null;
  const slug = clean.slice(RESOURCE_PREFIX.length);
  if (!slug || slug.includes("/")) return null; // 只收详情单段
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export type SiteVisitRow = { path: string; pv: number };

export type SummarizedSiteVisits = {
  /** 资源详情浏览，按期间 PV 降序（slug 已解码去重聚合）。 */
  resources: { slug: string; views: number }[];
  /** 白名单内非资源页面浏览（路径已去查询串），按 PV 降序。 */
  pages: { path: string; views: number }[];
};

/** 把「按精确路径聚合」的行整理成模型输入形态：资源按 slug 聚合、页面过滤白名单。 */
export function summarizeSiteVisits(rows: SiteVisitRow[]): SummarizedSiteVisits {
  const bySlug = new Map<string, number>();
  const byPage = new Map<string, number>();
  for (const row of rows) {
    const path = (row.path ?? "").split("?")[0];
    const slug = resourceSlugOf(path);
    if (slug) {
      bySlug.set(slug, (bySlug.get(slug) ?? 0) + row.pv);
      continue;
    }
    if (!PAGE_PREFIXES.some((prefix) => (prefix === "/" ? path === "/" : path.startsWith(prefix))))
      continue;
    byPage.set(path, (byPage.get(path) ?? 0) + row.pv);
  }
  const sort = (a: { views: number }, b: { views: number }) => b.views - a.views;
  return {
    resources: [...bySlug.entries()]
      .map(([slug, views]) => ({ slug, views }))
      .sort(sort)
      .slice(0, 12),
    pages: [...byPage.entries()]
      .map(([path, views]) => ({ path, views }))
      .sort(sort)
      .slice(0, 8),
  };
}

export type SiteMetricsSnapshot = {
  period: { from: string; to: string };
  totals: { pv: number; uv: number }; // pv=期间浏览量，uv=去重 IP
  content: { publishedInWindow: number }; // 期间新上架
  resources: Array<{
    slug: string;
    title: string;
    type: string;
    status: string;
    category: string | null;
    views: number;
  }>;
  pages: { path: string; views: number }[];
};

/** 拉取并拼装当前周期快照（访客浏览 → 内容元数据）。 */
export async function querySiteOverviewSnapshot(): Promise<SiteMetricsSnapshot> {
  const { from, to } = siteOverviewCycleDays();
  const fromDate = new Date(`${from}T00:00:00`);

  const [totalRow, pathRows, publishedInWindow] = await Promise.all([
    prisma.$queryRaw<Array<{ pv: number; uv: number }>>`
      SELECT COUNT(*)::int AS pv, COUNT(DISTINCT "ipHash")::int AS uv
      FROM "Visit" WHERE day >= ${from}`,
    prisma.$queryRaw<Array<{ path: string; pv: number }>>`
      SELECT path, COUNT(*)::int AS pv
      FROM "Visit" WHERE day >= ${from}
      GROUP BY path
      ORDER BY pv DESC, path ASC
      LIMIT 120`,
    prisma.resource.count({ where: { publishedAt: { gte: fromDate } } }),
  ]);

  const summarized = summarizeSiteVisits(pathRows.map((r) => ({ path: r.path, pv: Number(r.pv) })));
  const slugs = summarized.resources.map((r) => r.slug);
  const found = slugs.length
    ? await prisma.resource.findMany({
        where: { slug: { in: slugs } },
        select: {
          slug: true,
          title: true,
          type: true,
          status: true,
          category: { select: { name: true } },
        },
      })
    : [];
  const metaBySlug = new Map(found.map((r) => [r.slug, r]));
  const resources = summarized.resources.flatMap((item) => {
    const meta = metaBySlug.get(item.slug);
    return meta
      ? [
          {
            slug: item.slug,
            title: meta.title,
            type: meta.type,
            status: meta.status,
            category: meta.category?.name ?? null,
            views: item.views,
          },
        ]
      : [];
  });

  return {
    period: { from, to },
    totals: { pv: Number(totalRow[0]?.pv ?? 0), uv: Number(totalRow[0]?.uv ?? 0) },
    content: { publishedInWindow },
    resources,
    pages: summarized.pages.map((p) => ({ path: p.path, views: p.views })),
  };
}
