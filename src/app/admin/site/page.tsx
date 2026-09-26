import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getTheme, ensureSiteTheme } from "@/lib/site";
import { ensureHomeSections } from "@/lib/home";
import { HOME_SECTION_KINDS, parseSectionConfig, type HomeSectionKind } from "@/lib/home-config";
import { getAreaWidgets, type WidgetAreaKey } from "@/lib/site-config";
import SiteLayoutManager from "@/components/site-admin/SiteLayoutManager";
import HomeManager from "@/components/home-admin/HomeManager";
import SubTabs from "@/components/admin/SubTabs";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "站点布局" };

// 站点布局：首页板块流 + 全站布局（导航/详情模板/页面组件），tab 切换避免页面过长。
export default async function AdminSitePage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  // 首次进入自动落库默认数据，保证两个编辑器都有内容可编辑
  await Promise.all([ensureSiteTheme(), ensureHomeSections()]);
  const [theme, homeRows, categories, tags] = await Promise.all([
    getTheme(),
    prisma.homeSection.findMany({ orderBy: { order: "asc" } }),
    prisma.category.findMany({
      orderBy: [{ sort: "asc" }, { name: "asc" }],
      select: { slug: true, name: true },
    }),
    prisma.tag.findMany({
      orderBy: { count: "desc" },
      take: 60,
      select: { slug: true, name: true },
    }),
  ]);

  // ---- 首页布局数据：hero / 专题板块补全已选资源标题，供挑选器展示 ----
  const pickIds = new Set<string>();
  for (const r of homeRows) {
    if (r.kind === "hero" || r.kind === "featured") {
      const cfg = parseSectionConfig(r.kind as HomeSectionKind, r.config) as {
        featuredIds: string[];
      };
      for (const id of cfg.featuredIds) pickIds.add(id);
    }
  }
  const metas =
    pickIds.size > 0
      ? await prisma.resource.findMany({
          where: { id: { in: [...pickIds] }, status: "PUBLISHED" },
          select: { id: true, title: true, slug: true },
        })
      : [];
  const metaMap = new Map(metas.map((m) => [m.id, m]));

  const picksMap: Record<string, { id: string; title: string; slug: string }[]> = {};
  for (const r of homeRows) {
    if (r.kind === "hero" || r.kind === "featured") {
      const cfg = parseSectionConfig(r.kind as HomeSectionKind, r.config) as {
        featuredIds: string[];
      };
      picksMap[r.id] = cfg.featuredIds.flatMap((id) => (metaMap.get(id) ? [metaMap.get(id)!] : []));
    }
  }

  const viewRows = homeRows.map((r) => ({
    id: r.id,
    kind: (HOME_SECTION_KINDS as string[]).includes(r.kind)
      ? (r.kind as HomeSectionKind)
      : ("feed" as HomeSectionKind),
    title: r.title,
    order: r.order,
    enabled: r.enabled,
    visibleOn: (r.visibleOn === "pc" || r.visibleOn === "mobile" ? r.visibleOn : "all") as
      | "all"
      | "pc"
      | "mobile",
    requireAuth: r.requireAuth === true,
    config: parseSectionConfig(r.kind as HomeSectionKind, r.config),
  }));

  const widgetAreas: WidgetAreaKey[] = [
    "home",
    "archive",
    "archiveTop",
    "archiveBottom",
    "detail",
    "detailTop",
    "detailMiddle",
    "detailBottom",
  ];
  const widgetCount = widgetAreas.reduce((sum, area) => sum + getAreaWidgets(theme, area).length, 0);
  const enabledWidgetCount = widgetAreas.reduce(
    (sum, area) => sum + getAreaWidgets(theme, area).filter((widget) => widget.enabled).length,
    0,
  );
  const pageStats = [
    {
      label: "首页板块",
      value: `${homeRows.filter((row) => row.enabled).length} / ${homeRows.length}`,
      note: "已启用",
      tone: "brand",
    },
    {
      label: "顶部导航",
      value: `${theme.navbar.items.filter((item) => item.enabled).length} / ${theme.navbar.items.length}`,
      note: "已启用",
      tone: "neutral",
    },
    {
      label: "页面组件",
      value: `${enabledWidgetCount} / ${widgetCount}`,
      note: "已启用",
      tone: "neutral",
    },
  ] as const;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            站点设置 / 外观与布局
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-neutral-900">站点布局</h2>
          <p className="mt-1 text-sm text-neutral-500">
            管理首页内容顺序，以及全站导航、详情页和侧栏组件。
          </p>
        </div>
        <Link
          href="/"
          className="shrink-0 text-sm text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline"
        >
          查看前台 →
        </Link>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {pageStats.map((stat) => (
          <div key={stat.label} className="border border-neutral-200 bg-surface px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-neutral-500">{stat.label}</span>
              <span
                className={
                  stat.tone === "brand" ? "h-2 w-2 bg-brand-500" : "h-2 w-2 bg-neutral-300"
                }
                aria-hidden
              />
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <strong className="text-xl font-semibold tabular-nums text-neutral-900">{stat.value}</strong>
              <span className="text-xs text-neutral-400">{stat.note}</span>
            </div>
          </div>
        ))}
      </div>

      <SubTabs
        tabs={[
          { key: "home", label: "首页布局" },
          { key: "layout", label: "全站布局" },
        ]}
        panels={{
          home: (
            <>
              <p className="mb-4 rounded-none border border-brand-200 bg-surface px-4 py-3 text-xs leading-5 text-neutral-500">
                首页板块按顺序渲染，可拖拽排序、开关与增删；每个板块有独立配置。
              </p>
              <HomeManager rows={viewRows} picksMap={picksMap} categories={categories} tags={tags} />
            </>
          ),
          layout: (
            <>
              <p className="mb-4 rounded-none border border-brand-200 bg-surface px-4 py-3 text-xs leading-5 text-neutral-500">
                导航栏、详情页版式与各页面组件区域；改动实时应用到前台。
              </p>
              <SiteLayoutManager theme={theme} categories={categories} tags={tags} />
            </>
          ),
        }}
      />
    </div>
  );
}
