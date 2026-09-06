import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth";
import { parseMeta } from "@/lib/meta";
import { publicUrl } from "@/lib/storage";
import { getUploadLimits } from "@/lib/upload-limits";
import { TYPE_LABEL } from "@/lib/display";
import { ResourceEditForm } from "@/components/admin/ResourceEditForm";
import { ContentActions } from "@/components/admin/buttons";

export const metadata: Metadata = { title: "编辑内容" };

export default async function EditResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "MODERATOR") redirect("/admin/content");

  const [resource, categories, limits] = await Promise.all([
    prisma.resource.findUnique({
      where: { id },
      include: {
        tags: { include: { tag: { select: { name: true } } }, orderBy: { tag: { name: "asc" } } },
        author: { select: { username: true, name: true } },
        media: {
          where: { resourceId: { not: null } },
          orderBy: { sort: "asc" },
          select: { id: true, fileName: true, thumbKey: true, bigKey: true, storageKey: true },
        },
      },
    }),
    prisma.category.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    getUploadLimits(),
  ]);
  if (!resource) notFound();

  const meta = parseMeta(resource.type, resource.meta);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-medium text-neutral-900">编辑内容</h2>
          <p className="mt-0.5 truncate text-xs text-neutral-400">
            {TYPE_LABEL[resource.type]} · @{resource.author.username} ·{" "}
            <Link href={`/resources/${resource.slug}`} className="hover:text-brand-700 hover:underline">
              /{resource.slug}
            </Link>
          </p>
        </div>
        <ContentActions resourceId={resource.id} status={resource.status} />
      </div>

      <ResourceEditForm
        resource={{
          id: resource.id,
          slug: resource.slug,
          title: resource.title,
          summary: resource.summary ?? "",
          description: resource.description,
          type: resource.type,
          categoryId: resource.categoryId ?? categories[0]?.id ?? "",
          externalUrl: resource.externalUrl ?? "",
          tags: resource.tags.map((t) => t.tag.name).join(","),
          nsfw: resource.nsfw,
          loginRequired: resource.loginRequired,
          allowComments: resource.allowComments,
          isDownloadable: resource.isDownloadable,
          meta,
          gallery: (resource.media ?? []).map((m) => ({
            id: m.id,
            name: m.fileName ?? "image",
            thumbUrl: m.thumbKey ? publicUrl(m.thumbKey) : publicUrl(m.storageKey),
            bigUrl: m.bigKey ? publicUrl(m.bigKey) : publicUrl(m.storageKey),
          })),
          coverMediaId: resource.coverMediaId ?? "",
        }}
        categories={categories}
        limits={limits}
      />
    </div>
  );
}
