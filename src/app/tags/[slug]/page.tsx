import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import type { SP } from "@/lib/search-params";
import FeedBrowser from "@/components/feed/FeedBrowser";
import ArchiveShell from "@/components/feed/ArchiveShell";

type PageProps = { params: Promise<{ slug: string }>; searchParams: Promise<SP> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tag = await prisma.tag.findUnique({ where: { slug } });
  return { title: tag ? `#${tag.name}` : "标签" };
}

export default async function TagPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const [tag, sp] = await Promise.all([prisma.tag.findUnique({ where: { slug } }), searchParams]);
  if (!tag) notFound();

  return (
    <ArchiveShell
      heading={
        <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
          <h1 className="text-xl font-semibold tracking-tight">#{tag.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">共 {tag.count} 个相关内容</p>
        </div>
      }
    >
      <FeedBrowser base={`/tags/${slug}`} searchParams={{ ...sp, tag: slug }} />
    </ArchiveShell>
  );
}
