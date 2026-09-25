import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getHomeSections } from "@/lib/home";
import HomeRenderer from "@/components/home/HomeRenderer";
import { renderSiteSidebar } from "@/components/sidebar/SiteSidebar";
import SidebarLayout from "@/components/layout/SidebarLayout";
import { getTheme } from "@/lib/site";
import type { SP } from "@/lib/search-params";

import { getSeoConfig, resolveSiteName } from "@/lib/seo-config";

// root layout 的 title.template 不作用于与其同段的首页，需自行拼接站点名
export async function generateMetadata(): Promise<Metadata> {
  const name = resolveSiteName(await getSeoConfig());
  return { title: `发现 · ${name}` };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = (await auth())?.user;

  const [sections, theme] = await Promise.all([getHomeSections(), getTheme()]);
  // 先解析真实侧栏内容再交给布局，游客只剩登录专属模块时不会占用空右栏。
  const rail = await renderSiteSidebar({ theme, page: "home", authed: !!u });

  return (
    <SidebarLayout
      railWidth={theme.sidebar.width}
      // 侧栏列顶部与首屏横幅（hero 的 pt-8）对齐；移动端侧栏在内容下方不需要
      rail={rail ?? undefined}
    >
      <HomeRenderer sections={sections} sp={sp} authed={!!u} userId={u?.id} />
    </SidebarLayout>
  );
}
