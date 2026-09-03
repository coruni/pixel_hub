import { auth } from "@/lib/auth";
import { getHomeSections } from "@/lib/home";
import { getTheme } from "@/lib/site";
import { sidebarVisible } from "@/lib/site-config";
import HomeRenderer from "@/components/home/HomeRenderer";
import SiteSidebar from "@/components/sidebar/SiteSidebar";
import SidebarLayout from "@/components/layout/SidebarLayout";

export const metadata = { title: "发现" };

type SP = Record<string, string | string[] | undefined>;
export default async function HomePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await auth();
  const u = session?.user;

  const [sections, theme] = await Promise.all([getHomeSections(), getTheme()]);
  const showSidebar = sidebarVisible(theme, "home");

  return (
    <SidebarLayout
      railWidth={theme.sidebar.width}
      // 侧栏列顶部与首屏横幅（hero 的 pt-8）对齐；移动端侧栏在内容下方不需要
      rail={showSidebar ? (
        <div className="md:pt-8">
          <SiteSidebar theme={theme} />
        </div>
      ) : undefined}
    >
      <HomeRenderer sections={sections} sp={sp} authed={!!u} userId={u?.id} />
    </SidebarLayout>
  );
}
