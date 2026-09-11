import { Fragment, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  getAreaWidgets,
  visibleOnClass,
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
  authed,
}: {
  theme: Theme;
  page: SidebarPageKey;
  detail?: DetailWidgetCtx;
  authed?: boolean;
}) {
  const widgets = theme.sidebar.widgetsByPage[page].filter(
    (w) => w.enabled && !(w.requireAuth && !authed),
  );
  if (widgets.length === 0) return null;

  const nodes = await renderWidgets(widgets, detail, authed);
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
  authed,
}: {
  theme: Theme;
  area: WidgetAreaKey;
  detail?: DetailWidgetCtx;
  authed?: boolean;
}) {
  const widgets = getAreaWidgets(theme, area).filter(
    (w) => w.enabled && !(w.requireAuth && !authed),
  );
  if (widgets.length === 0) return null;

  const nodes = await renderWidgets(widgets, detail, authed);
  if (!nodes) return null;

  return <div className="space-y-4">{nodes}</div>;
}

/** 渲染一批组件：primary 直出，more 收进底部「更多」折叠组（原生 details，无 JS、可键盘、尊重 reduced-motion）；
 *  每个组件按其 visibleOn 用响应式容器包裹（pc/mobile 仅在对应端显示），requireAuth 已在外部过滤 */
async function renderWidgets(
  widgets: SidebarWidget[],
  detail?: DetailWidgetCtx,
  authed?: boolean,
): Promise<ReactNode | null> {
  const primaries: ReactNode[] = [];
  const mores: ReactNode[] = [];
  for (let i = 0; i < widgets.length; i++) {
    const w = widgets[i];
    const node = await renderWidget(w, detail);
    if (!node) continue;
    const cls = visibleOnClass(w.visibleOn);
    const wrapped = cls ? (
      <div key={`${w.kind}-${i}`} className={cls}>
        {node}
      </div>
    ) : (
      <Fragment key={`${w.kind}-${i}`}>{node}</Fragment>
    );
    if (w.tier === "more") mores.push(wrapped);
    else primaries.push(wrapped);
  }
  if (primaries.length === 0 && mores.length === 0) return null;

  return (
    <>
      {primaries}
      {mores.length > 0 && (
        <details className="group rounded-none border border-brand-200 bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-semibold tracking-wider text-neutral-500 motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
            更多模块
            <ChevronDown
              size={14}
              className="text-neutral-400 transition-transform duration-200 group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="space-y-4 px-4 pb-4 pt-0">{mores}</div>
        </details>
      )}
    </>
  );
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
