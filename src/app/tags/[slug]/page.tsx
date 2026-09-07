import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import type { SP } from "@/lib/search-params";
import FeedBrowser from "@/components/feed/FeedBrowser";
import ArchiveShell from "@/components/feed/ArchiveShell";

type PageProps = { params: Promise<{ slug: string }>; searchParams: Promise<SP> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const tag = await prisma.tag.findUnique({ where: { slug } });
  // canonical 锚定到无参数形态：分页/筛选 query 不产生重复收录
  return {
    title: tag ? `#${tag.name}` : "标签",
    alternates: { canonical: `/tags/${slug}` },
  };
}

export default async function TagPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const [tag, sp] = await Promise.all([prisma.tag.findUnique({ where: { slug } }), searchParams]);
  if (!tag) notFound();

  // D9：游客的「共 N 个」口径对齐其可见列表（不含 NSFW），避免标题计数与空列表矛盾
  const session = await auth();
  const meId =
    typeof session?.user?.id === "string" && session.user.id ? session.user.id : undefined;
  const visibleCount = await prisma.resource.count({
    where: {
      status: "PUBLISHED",
      ...(meId ? {} : { nsfw: false }),
      tags: { some: { tag: { slug } } },
    },
  });

  return (
    <ArchiveShell
      heading={
        <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
          <h1 className="text-xl font-semibold tracking-tight">#{tag.name}</h1>
          <p className="mt-1 text-sm text-neutral-500">共 {visibleCount} 个相关内容</p>
        </div>
      }
    >
      <FeedBrowser base={`/tags/${slug}`} searchParams={{ ...sp, tag: slug }} />
    </ArchiveShell>
  );
}
