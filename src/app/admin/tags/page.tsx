import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { TagManager } from "@/components/admin/TaxonomyManager";
import { TableFooter } from "@/components/admin/DataTable";
import { ADMIN_PAGE_SIZE, adminQuery } from "@/lib/admin/paging";
import { intParam, str, type SP } from "@/lib/search-params";

export const metadata: Metadata = { title: "标签管理" };

export default async function TagsAdminPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  const sp = await searchParams;
  const q = str(sp, "q") ?? "";
  const page = intParam(sp, "page", 1);
  const pageSize = Math.min(100, intParam(sp, "size", ADMIN_PAGE_SIZE));

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { slug: { contains: q } },
        ],
      }
    : {};

  const [total, pageRows] = await Promise.all([
    prisma.tag.count({ where }),
    prisma.tag.findMany({
      where,
      orderBy: { count: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, slug: true, count: true },
    }),
  ]);
  const hasMore = (page - 1) * pageSize + pageRows.length < total;

  const baseQuery: Record<string, string> = {};
  if (q) baseQuery.q = q;
  const href = (p: number) =>
    `/admin/tags${adminQuery({
      ...baseQuery,
      page: String(p),
      ...(pageSize !== ADMIN_PAGE_SIZE ? { size: String(pageSize) } : {}),
    })}`;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">标签管理</h2>
      </div>

      <TagManager
        key={`${page}-${pageSize}-${q}`}
        rows={pageRows}
        q={q}
        pageSize={pageSize}
      />

      <TableFooter page={page} hasMore={hasMore} total={total} pageSize={pageSize} href={href} />
    </div>
  );
}
