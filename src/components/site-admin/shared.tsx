import {
  BarChart3,
  FileText,
  FolderTree,
  Info,
  Layers,
  LayoutGrid,
  Megaphone,
  MessageSquare,
  RectangleHorizontal,
  Shuffle,
  Tags as TagsIcon,
  TrendingUp,
  Users,
} from "lucide-react";
import type { ActionResult } from "@/lib/hooks";
import type { SidebarWidgetKind, WidgetAreaKey } from "@/lib/site-config";

export type SiteCategories = { slug: string; name: string }[];
export type SiteTags = { slug: string; name: string }[];

/** 统一的 action 执行器（失败弹 alert，成功后 refresh），由 SiteLayoutManager 下发给各卡片 */
export type RunFn = (fn: () => Promise<ActionResult>) => void;

/** 组件 kind → 图标（列表行首标识） */
export function KindIcon({ kind, size = 15 }: { kind: SidebarWidgetKind; size?: number }) {
  const map: Record<SidebarWidgetKind, typeof TrendingUp> = {
    hot: TrendingUp,
    categories: LayoutGrid,
    tags: TagsIcon,
    creators: Users,
    stats: BarChart3,
    about: Info,
    comments: MessageSquare,
    random: Shuffle,
    notice: Megaphone,
    custom: FileText,
    authorWorks: Layers,
    sameCategory: FolderTree,
    ad: RectangleHorizontal,
  };
  const Icon = map[kind] ?? TrendingUp;
  return <Icon size={size} aria-hidden />;
}

/** 组件可投放区域页签：3 个侧边栏页面 + 5 个内容槽位（详情上/中/下 + 归档上/下）；首页板块流在站点布局页上方区域管理 */
export const AREA_TABS: { key: WidgetAreaKey; label: string; hint: string }[] = [
  { key: "home", label: "首页侧栏", hint: "首页右侧边栏" },
  { key: "archive", label: "归档侧栏", hint: "浏览 / 搜索 / 标签页右侧边栏" },
  { key: "archiveTop", label: "归档·上方", hint: "浏览 / 搜索 / 标签页内容之前" },
  { key: "archiveBottom", label: "归档·下方", hint: "浏览 / 搜索 / 标签页内容之后（页尾）" },
  { key: "detail", label: "详情侧栏", hint: "资源详情页右侧边栏" },
  { key: "detailTop", label: "详情·上方", hint: "详情页正文上方（横幅下方）" },
  { key: "detailMiddle", label: "详情·中部", hint: "详情页描述与评论之间" },
  { key: "detailBottom", label: "详情·下方", hint: "详情页页尾（相关推荐之后）" },
];

/** 侧边栏整体开关对应的三个页面（showOn） */
export const PAGE_LABELS: { key: "home" | "archive" | "detail"; label: string; hint: string }[] = [
  { key: "home", label: "首页", hint: "页面主内容（板块流）右侧" },
  { key: "archive", label: "归档页", hint: "浏览 / 搜索 / 标签页右侧" },
  { key: "detail", label: "资源详情", hint: "单资源详情页右侧" },
];
