import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { TagManager } from "@/components/admin/TaxonomyManager";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "标签管理" };

export default async function TagsAdminPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  const rows = await prisma.tag.findMany({
    orderBy: { count: "desc" },
    take: 1000,
    select: { id: true, name: true, slug: true, count: true },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">标签管理</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          标签由发布时自动创建；此处可重命名、合并或清理无效标签。
        </p>
      </div>
      <TagManager rows={rows} />
    </div>
  );
}
