import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { getTheme } from "@/lib/site";
import { sidebarVisible } from "@/lib/site-config";
import FeedBrowser from "@/components/feed/FeedBrowser";
import SiteSidebar from "@/components/sidebar/SiteSidebar";
import SidebarLayout from "@/components/layout/SidebarLayout";

type SP = Record<string, string | string[] | undefined>;
type PageProps = { params: Promise<{ slug: string }>; searchParams: Promise<SP> };

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const tag = await prisma.tag.findUnique({ where: { slug } });
  return { title: tag ? `#${tag.name}` : "标签" };
}

export default async function TagPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const [tag, sp, theme] = await Promise.all([prisma.tag.findUnique({ where: { slug } }), searchParams, getTheme()]);
  if (!tag) notFound();
  const showSidebar = sidebarVisible(theme, "archive");

  return (
    <SidebarLayout railWidth={theme.sidebar.width} rail={showSidebar ? <SiteSidebar theme={theme} /> : undefined}>
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">#{tag.name}</h1>
        <p className="mt-1 text-sm text-neutral-500">共 {tag.count} 个相关内容</p>
      </div>
      <FeedBrowser base={`/tags/${slug}`} searchParams={{ ...sp, tag: slug }} />
    </SidebarLayout>
  );
}
