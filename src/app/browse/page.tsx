import { auth } from "@/lib/auth";
import { getTheme } from "@/lib/site";
import { sidebarVisible } from "@/lib/site-config";
import FeedBrowser from "@/components/feed/FeedBrowser";
import SiteSidebar, { WidgetArea } from "@/components/sidebar/SiteSidebar";
import SidebarLayout from "@/components/layout/SidebarLayout";

export const metadata = { title: "浏览" };

type SP = Record<string, string | string[] | undefined>;
export default async function BrowsePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await auth();
  const u = session?.user;
  const theme = await getTheme();
  const showSidebar = sidebarVisible(theme, "archive");

  // 归档页内容槽位（信息流之前/之后）
  const hasSlot = (area: "archiveTop" | "archiveBottom") => theme.slots[area].some((w) => w.enabled);

  return (
    <SidebarLayout railWidth={theme.sidebar.width} rail={showSidebar ? <SiteSidebar theme={theme} page="archive" /> : undefined}>
      {hasSlot("archiveTop") && (
        <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
          <WidgetArea theme={theme} area="archiveTop" />
        </div>
      )}
      <FeedBrowser base="/browse" searchParams={sp} authed={!!u} userId={u?.id} />
      {hasSlot("archiveBottom") && (
        <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
          <WidgetArea theme={theme} area="archiveBottom" />
        </div>
      )}
    </SidebarLayout>
  );
}
