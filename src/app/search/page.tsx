import { auth } from "@/lib/auth";
import { getTheme } from "@/lib/site";
import { sidebarVisible } from "@/lib/site-config";
import FeedBrowser from "@/components/feed/FeedBrowser";
import SiteSidebar, { WidgetArea } from "@/components/sidebar/SiteSidebar";
import SidebarLayout from "@/components/layout/SidebarLayout";

export const metadata = { title: "搜索" };

type SP = Record<string, string | string[] | undefined>;
export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
 const sp = await searchParams;
 const session = await auth();
 const u = session?.user;
 const q = typeof sp.q === "string" ? sp.q.trim() : "";
 const theme = await getTheme();
 const showSidebar = sidebarVisible(theme, "archive");
 // 归档页内容槽位（搜索框之前/结果流之后）
 const hasSlot = (area: "archiveTop" | "archiveBottom") => theme.slots[area].some((w) => w.enabled);

 return (
 <SidebarLayout railWidth={theme.sidebar.width} rail={showSidebar ? <SiteSidebar theme={theme} page="archive" /> : undefined}>
 {hasSlot("archiveTop") && (
 <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
 <WidgetArea theme={theme} area="archiveTop" />
 </div>
 )}
 <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
 <form action="/search" method="get" className="flex max-w-xl gap-2">
 <input
 name="q"
 defaultValue={q}
 placeholder="搜索资源、作者或标签…"
 className="w-full rounded-none border border-brand-200 bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand-500"
 />
 <button type="submit" className="rounded-none border border-brand-600 bg-brand-500 px-5 text-sm font-medium text-white hover:bg-brand-600">
 搜索
 </button>
 </form>
 {q && (
 <p className="mt-4 text-sm text-neutral-500">
 「<span className="font-medium text-neutral-900">{q}</span>」的结果
 </p>
 )}
 </div>
 {q && <FeedBrowser base="/search" searchParams={sp} authed={!!u} userId={u?.id} />}
 {hasSlot("archiveBottom") && (
 <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
 <WidgetArea theme={theme} area="archiveBottom" />
 </div>
 )}
 </SidebarLayout>
 );
}
