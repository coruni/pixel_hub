import Link from "next/link";
import BlockShell from "@/components/home/BlockShell";
import { prisma } from "@/lib/db/prisma";
import { getTopTags } from "@/lib/queries";
import { formatCount } from "@/lib/format";

export default async function TagsBlock({
  title,
  count,
  slugs,
}: {
  title: string | null;
  count: number;
  slugs: string[];
}) {
  let tags: { slug: string; name: string; count: number }[];
  if (slugs.length > 0) {
    const rows = await prisma.tag.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, name: true, count: true },
    });
    const bySlug = new Map(rows.map((t) => [t.slug, t]));
    tags = slugs.flatMap((s) => (bySlug.get(s) ? [bySlug.get(s)!] : []));
  } else {
    tags = await getTopTags(count);
  }
  if (tags.length === 0) return null;

  return (
    <BlockShell title={title} className="mt-8 pb-8">
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <Link
            key={t.slug}
            href={`/tags/${t.slug}`}
            className="rounded-none border border-brand-200 bg-surface px-3.5 py-1.5 text-sm text-neutral-600 transition hover:border-brand-400 hover:text-brand-700"
          >
            #{t.name}
            <span className="ml-1 text-[11px] text-neutral-400">{formatCount(t.count)}</span>
          </Link>
        ))}
      </div>
    </BlockShell>
  );
}
