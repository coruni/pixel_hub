import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { CategoryManager } from "@/components/admin/TaxonomyManager";
import { TableFooter } from "@/components/admin/DataTable";
import { ADMIN_PAGE_SIZE, adminQuery } from "@/lib/admin/paging";
import { intParam, type SP } from "@/lib/search-params";

export const metadata: Metadata = { title: "分类管理" };

export default async function CategoriesAdminPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  const sp = await searchParams;
  const page = intParam(sp, "page", 1);
  const pageSize = Math.min(100, intParam(sp, "size", ADMIN_PAGE_SIZE));

  const all = await prisma.category.findMany({
    orderBy: [{ sort: "asc" }, { name: "asc" }],
    include: { _count: { select: { resources: true, children: true } } },
  });

  // 层级有序列表：顶级在前，紧接其子分类（两级），分页在扁平结果上切片。
  const tops = all
    .filter((c) => !c.parentId)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const ordered = [...tops];
  for (const t of tops) {
    const kids = all
      .filter((c) => c.parentId === t.id)
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    ordered.push(...kids);
  }

  const total = ordered.length;
  const start = (page - 1) * pageSize;
  const pageRows = ordered.slice(start, start + pageSize);
  const hasMore = start + pageRows.length < total;

  const baseQuery: Record<string, string> = {};
  const href = (p: number) =>
    `/admin/categories${adminQuery({
      ...baseQuery,
      page: String(p),
      ...(pageSize !== ADMIN_PAGE_SIZE ? { size: String(pageSize) } : {}),
    })}`;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">分类管理</h2>
      </div>

      <CategoryManager
        key={`${page}-${pageSize}`}
        rows={pageRows.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          sort: c.sort,
          resourceCount: c._count.resources,
          childCount: c._count.children,
          parentId: c.parentId,
        }))}
      />

      <TableFooter page={page} hasMore={hasMore} total={total} pageSize={pageSize} href={href} />
    </div>
  );
}
