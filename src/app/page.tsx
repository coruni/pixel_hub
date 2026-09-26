import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getHomeSections } from "@/lib/home";
import HomeRenderer from "@/components/home/HomeRenderer";
import { renderSiteSidebar } from "@/components/sidebar/SiteSidebar";
import SidebarLayout from "@/components/layout/SidebarLayout";
import { getTheme } from "@/lib/site";
import type { SP } from "@/lib/search-params";

import { getSeoConfig, resolveHomeTitle, resolveSiteName } from "@/lib/seo-config";

// root layout 的 title.template 不作用于与其同段的首页，需自行拼接站点名。
// 标题主体来自后台「首页标题 / 首页副标题」（拼成「标题 - 副标题」），未配置时回退「发现」。
export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeoConfig();
  const name = resolveSiteName(seo);
  const title = resolveHomeTitle(seo);
  return {
    title: `${title} - ${name}`,
    // 首页描述：后台默认描述优先，其次副标题，最后内置文案
    description:
      seo.defaultDescription ||
      seo.homeSubtitle ||
      `分享与发现图片、游戏等数字资源的${name}平台`,
  };
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
