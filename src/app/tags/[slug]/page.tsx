import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { getTheme } from "@/lib/site";
import { sidebarVisible } from "@/lib/site-config";
import FeedBrowser from "@/components/feed/FeedBrowser";
import SiteSidebar, { WidgetArea } from "@/components/sidebar/SiteSidebar";
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
  // 归档页内容槽位（标签标题之前/信息流之后）
  const hasSlot = (area: "archiveTop" | "archiveBottom") => theme.slots[area].some((w) => w.enabled);

  return (
    <SidebarLayout railWidth={theme.sidebar.width} rail={showSidebar ? <SiteSidebar theme={theme} page="archive" /> : undefined}>
      {hasSlot("archiveTop") && (
        <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
          <WidgetArea theme={theme} area="archiveTop" />
        </div>
      )}
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">#{tag.name}</h1>
        <p className="mt-1 text-sm text-neutral-500">共 {tag.count} 个相关内容</p>
      </div>
      <FeedBrowser base={`/tags/${slug}`} searchParams={{ ...sp, tag: slug }} />
      {hasSlot("archiveBottom") && (
        <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
          <WidgetArea theme={theme} area="archiveBottom" />
        </div>
      )}
    </SidebarLayout>
  );
}
