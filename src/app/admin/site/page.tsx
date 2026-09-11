import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getTheme, ensureSiteTheme } from "@/lib/site";
import { ensureHomeSections } from "@/lib/home";
import { HOME_SECTION_KINDS, parseSectionConfig, type HomeSectionKind } from "@/lib/home-config";
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-neutral-900">站点布局</h2>
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 hover:underline">
          查看前台 →
        </Link>
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
