import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { ensureHomeSections } from "@/lib/home";
import { HOME_SECTION_KINDS, parseSectionConfig, type HomeSectionKind } from "@/lib/home-config";
import HomeManager from "@/components/home-admin/HomeManager";

export const metadata = { title: "首页布局" };

export default async function AdminHomePage() {
 const session = await auth();
 if (session?.user?.role !== "ADMIN") redirect("/admin");

 // 首次进入自动落库默认布局（空库兜底），保证列表可编辑
 await ensureHomeSections();
 const rows = await prisma.homeSection.findMany({ orderBy: { order: "asc" } });

 // hero / 专题（featured）板块：补全已选资源的标题，供挑选器展示
 const pickIds = new Set<string>();
 for (const r of rows) {
 if (r.kind === "hero" || r.kind === "featured") {
 const cfg = parseSectionConfig(r.kind as HomeSectionKind, r.config) as { featuredIds: string[] };
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
 for (const r of rows) {
 if (r.kind === "hero" || r.kind === "featured") {
 const cfg = parseSectionConfig(r.kind as HomeSectionKind, r.config) as { featuredIds: string[] };
 picksMap[r.id] = cfg.featuredIds.flatMap((id) => (metaMap.get(id) ? [metaMap.get(id)!] : []));
 }
 }

 const viewRows = rows.map((r) => ({
 id: r.id,
 kind: (HOME_SECTION_KINDS as string[]).includes(r.kind) ? (r.kind as HomeSectionKind) : ("feed" as HomeSectionKind),
 title: r.title,
 order: r.order,
 enabled: r.enabled,
 config: parseSectionConfig(r.kind as HomeSectionKind, r.config),
 }));

 // 编辑器里分类/标签多选需的候选列表
 const [categories, tags] = await Promise.all([
 prisma.category.findMany({
 orderBy: [{ sort: "asc" }, { name: "asc" }],
 select: { slug: true, name: true },
 }),
 prisma.tag.findMany({ orderBy: { count: "desc" }, take: 60, select: { slug: true, name: true } }),
 ]);

 return (
 <div>
 <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
 <h2 className="text-lg font-medium text-neutral-900">首页布局</h2>
 <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 hover:underline">
 查看前台首页 →
 </Link>
 </div>
 <p className="mb-4 rounded-none border border-brand-200 bg-surface px-4 py-3 text-xs leading-5 text-neutral-500">
 像搭建 WordPress 首页一样管理首页：板块按顺序渲染，可拖拽排序、开关与增删，每个板块有独立配置。
 可加「内容流板块」做条件列表（类型/排序 + 分类与标签多选，卡片·列表·瀑布流），或用「专题精选」把指定资源组成专题。
 此页仅管理员可见；「浏览」(/browse) 页为独立归档页，不受影响。
 </p>
 <HomeManager rows={viewRows} picksMap={picksMap} categories={categories} tags={tags} />
 </div>
 );
}
