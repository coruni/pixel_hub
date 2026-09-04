import type { ReactNode } from "react";
import { getTheme } from "@/lib/site";
import { sidebarVisible } from "@/lib/site-config";
import SiteSidebar, { WidgetArea } from "@/components/sidebar/SiteSidebar";
import SidebarLayout from "@/components/layout/SidebarLayout";

/**
 * 归档类页面（browse / search / tags）共享外壳：
 * 侧边栏（archive 侧栏配置）+ 归档上/下内容槽位。页面差异收敛为 heading 与 children。
 */
export default async function ArchiveShell({ heading, children }: { heading?: ReactNode; children: ReactNode }) {
  const theme = await getTheme();
  const showSidebar = sidebarVisible(theme, "archive");
  const hasSlot = (area: "archiveTop" | "archiveBottom") => theme.slots[area].some((w) => w.enabled);

  return (
    <SidebarLayout railWidth={theme.sidebar.width} rail={showSidebar ? <SiteSidebar theme={theme} page="archive" /> : undefined}>
      {hasSlot("archiveTop") && (
        <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
          <WidgetArea theme={theme} area="archiveTop" />
        </div>
      )}
      {heading}
      {children}
      {hasSlot("archiveBottom") && (
        <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
          <WidgetArea theme={theme} area="archiveBottom" />
        </div>
      )}
    </SidebarLayout>
  );
}
