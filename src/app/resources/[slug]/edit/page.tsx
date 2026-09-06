import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { parseMeta } from "@/lib/meta";
import { publicUrl } from "@/lib/storage";
import { getUploadLimits } from "@/lib/upload-limits";
import { ResourceEditForm } from "@/components/admin/ResourceEditForm";
import { updateResourceOwnerAction } from "@/lib/actions/resource";

export const metadata: Metadata = { title: "编辑我的资源" };

export default async function EditOwnResourcePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(`/resources/${slug}/edit`)}`);

  const [resource, categories, limits] = await Promise.all([
    prisma.resource.findUnique({
      where: { slug },
      include: {
        tags: { include: { tag: { select: { name: true } } }, orderBy: { tag: { name: "asc" } } },
        media: {
          where: { resourceId: { not: null } },
          orderBy: { sort: "asc" },
          select: { id: true, fileName: true, thumbKey: true, bigKey: true, storageKey: true },
        },
      },
    }),
    prisma.category.findMany({
      orderBy: [{ sort: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    getUploadLimits(),
  ]);
  if (!resource) notFound();
  if (resource.authorId !== session.user.id) redirect(`/resources/${slug}`);

  const meta = parseMeta(resource.type, resource.meta);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-4 min-w-0">
        <h1 className="text-lg font-medium text-neutral-900">编辑我的资源</h1>
        <p className="mt-0.5 truncate text-xs text-neutral-400">
          仅你本人可编辑 ·{" "}
          <Link href={`/resources/${resource.slug}`} className="hover:text-brand-700 hover:underline">
            /{resource.slug}
          </Link>
        </p>
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
        action={updateResourceOwnerAction}
        backHref={`/resources/${resource.slug}`}
        backLabel="返回资源页"
        limits={limits}
      />
    </div>
  );
}
