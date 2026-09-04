import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getTheme, ensureSiteTheme } from "@/lib/site";
import SiteLayoutManager from "@/components/site-admin/SiteLayoutManager";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "站点布局" };

export default async function AdminSitePage() {
 const session = await auth();
 if (session?.user?.role !== "ADMIN") redirect("/admin");

 // 首次进入自动落库默认主题，保证设置页有数据可编辑
 await ensureSiteTheme();
 const [theme, categories, tags] = await Promise.all([
 getTheme(),
 prisma.category.findMany({
 orderBy: [{ sort: "asc" }, { name: "asc" }],
 select: { slug: true, name: true },
 }),
 prisma.tag.findMany({
 orderBy: { count: "desc" },
 take: 50,
 select: { slug: true, name: true },
 }),
 ]);

 return (
 <div>
 <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
 <h2 className="text-lg font-medium text-neutral-900">站点布局</h2>
 <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 hover:underline">
 查看前台 →
 </Link>
 </div>
 <p className="mb-4 rounded-none border border-brand-200 bg-surface px-4 py-3 text-xs leading-5 text-neutral-500">
 全局外观配置，作用于首页 / 归档页（浏览·搜索·标签）/ 资源详情页：侧边栏在哪些页面启用、是否固定、栏宽与所含组件；
 以及详情页版式（按类型可覆盖）。改动实时保存并应用到前台。此页仅管理员可见。
 </p>
 <SiteLayoutManager
 theme={theme}
 categories={categories.map((c) => ({
 slug: c.slug,
 name: c.name,
 }))}
 tags={tags}
 />
 </div>
 );
}
