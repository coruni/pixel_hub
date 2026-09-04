import { Fragment, type ReactNode } from "react";
import {
  getAreaWidgets,
  type SidebarWidget,
  type SidebarPageKey,
  type Theme,
  type WidgetAreaKey,
} from "@/lib/site-config";
import { type DetailWidgetCtx } from "./shell";
import { renderAuthorWorks, renderHot, renderRandom, renderSameCategory } from "./widgets/feed";
import { renderCategories, renderComments, renderCreators, renderTags } from "./widgets/lists";
import { renderAbout, renderAd, renderCustom, renderNotice, renderStats } from "./widgets/misc";

// 站点级侧边栏：按页面分组（home/archive/detail）渲染 theme 里启用的 widgets 成可 sticky 的右栏。
// 开关位置见 lib/site-config.ts 的 sidebarVisible；sticky 由 theme.sidebar.sticky 控制。
// detail 上下文（当前资源）供「作者其它作品 / 同分类推荐」等详情页专用组件取数。

export type { DetailWidgetCtx };

export default async function SiteSidebar({
  theme,
  page,
  detail,
}: {
  theme: Theme;
  page: SidebarPageKey;
  detail?: DetailWidgetCtx;
}) {
  const widgets = theme.sidebar.widgetsByPage[page].filter((w) => w.enabled);
  if (widgets.length === 0) return null;

  const nodes = await renderWidgets(widgets, detail);
  if (!nodes) return null;

  return (
    <aside className={`space-y-4 mt-8 ${theme.sidebar.sticky ? "sticky top-16 h-fit" : "h-fit"}`}>
      {nodes}
    </aside>
  );
}

/**
 * 详情页正文槽位（上/中/下）：渲染区域内的启用组件，供 resources/[slug] 嵌入内容流。
 * 槽位组件同样可用详情上下文（作者其它作品等）。
 */
export async function WidgetArea({
  theme,
  area,
  detail,
}: {
  theme: Theme;
  area: WidgetAreaKey;
  detail?: DetailWidgetCtx;
}) {
  const widgets = getAreaWidgets(theme, area).filter((w) => w.enabled);
  if (widgets.length === 0) return null;

  const nodes = await renderWidgets(widgets, detail);
  if (!nodes) return null;

  return <div className="space-y-4">{nodes}</div>;
}

/** 渲染一批组件（跳过空渲染的），全部为空时返回 null */
async function renderWidgets(
  widgets: SidebarWidget[],
  detail?: DetailWidgetCtx,
): Promise<ReactNode | null> {
  const nodes: ReactNode[] = [];
  for (let i = 0; i < widgets.length; i++) {
    const node = await renderWidget(widgets[i], detail);
    if (node) nodes.push(<Fragment key={`${widgets[i].kind}-${i}`}>{node}</Fragment>);
  }
  return nodes.length > 0 ? nodes : null;
}

async function renderWidget(w: SidebarWidget, detail?: DetailWidgetCtx): Promise<ReactNode | null> {
  switch (w.kind) {
    case "hot":
      return renderHot(w);
    case "categories":
      return renderCategories(w);
    case "tags":
      return renderTags(w);
    case "creators":
      return renderCreators(w);
    case "stats":
      return renderStats(w);
    case "about":
      return renderAbout(w);
    case "comments":
      return renderComments(w);
    case "random":
      return renderRandom(w);
    case "notice":
      return renderNotice(w);
    case "custom":
      return renderCustom(w);
    case "authorWorks":
      return renderAuthorWorks(w, detail);
    case "sameCategory":
      return renderSameCategory(w, detail);
    case "ad":
      return renderAd(w);
    default:
      return null;
  }
}
