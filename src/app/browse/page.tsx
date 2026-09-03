import { auth } from "@/lib/auth";
import { getTheme } from "@/lib/site";
import { sidebarVisible } from "@/lib/site-config";
import FeedBrowser from "@/components/feed/FeedBrowser";
import SiteSidebar from "@/components/sidebar/SiteSidebar";
import SidebarLayout from "@/components/layout/SidebarLayout";

export const metadata = { title: "浏览" };

type SP = Record<string, string | string[] | undefined>;
export default async function BrowsePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await auth();
  const u = session?.user;
  const theme = await getTheme();
  const showSidebar = sidebarVisible(theme, "archive");

  return (
    <SidebarLayout railWidth={theme.sidebar.width} rail={showSidebar ? <SiteSidebar theme={theme} /> : undefined}>
      <FeedBrowser base="/browse" searchParams={sp} authed={!!u} userId={u?.id} />
    </SidebarLayout>
  );
}
