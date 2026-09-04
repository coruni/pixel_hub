import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { CategoryManager } from "@/components/admin/TaxonomyManager";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "分类管理" };

export default async function CategoriesAdminPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  const rows = await prisma.category.findMany({
    orderBy: [{ sort: "asc" }, { name: "asc" }],
    include: { _count: { select: { resources: true, children: true } } },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">分类管理</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          分类对所有内容类型通用（图片/游戏共用一套分类），类型区分由内容自身的「类型」决定。
        </p>
      </div>
      <CategoryManager
        rows={rows.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          sort: c.sort,
          resourceCount: c._count.resources,
        }))}
      />
    </div>
  );
}
