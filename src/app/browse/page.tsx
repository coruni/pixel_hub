import type { Metadata } from "next";
import { Search } from "lucide-react";
import { auth } from "@/lib/auth";
import { intParam, str, type SP } from "@/lib/search-params";
import FeedBrowser from "@/components/feed/FeedBrowser";
import ArchiveShell from "@/components/feed/ArchiveShell";
import { Button } from "@/components/ui/Button";

/** 规范 URL 只保留 cat 与 page（page>1）：搜索词/排序/筛选不进 canonical，避免重复内容漂移 */
function canonicalOf(sp: SP): string {
  const cat = str(sp, "cat")?.trim();
  const page = intParam(sp, "page", 1);
  const params = new URLSearchParams();
  if (cat) params.set("cat", cat);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/browse?${qs}` : "/browse";
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SP>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const q = str(sp, "q")?.trim();
  if (q) {
    // 带查询词的页面拒绝收录：防止搜索引擎收录海量低质查询 URL（Google 官方建议）
    return { title: "搜索", robots: { index: false, follow: true } };
  }
  return { title: "浏览", alternates: { canonical: canonicalOf(sp) } };
}

export default async function BrowsePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = (await auth())?.user;
  const q = str(sp, "q")?.trim() ?? "";
  return (
    <ArchiveShell
      heading={
        q ? (
          <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
            {/* 搜索结果态的改词搜索框：仅带 q（进入页面即在搜索）时显示 */}
            <form action="/browse" method="get" className="flex w-full max-w-full gap-2">
              <input
                name="q"
                defaultValue={q}
                placeholder="搜索资源、作者或标签…"
                className="min-w-0 flex-1 rounded-none border border-brand-200 bg-surface px-4 py-2.5 text-sm outline-none transition placeholder:text-neutral-400 focus:border-brand-500"
              />
              <Button
                type="submit"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 rounded-none border border-brand-600 bg-brand-500 text-sm font-medium text-white transition hover:bg-brand-600 sm:w-auto sm:px-5"
              >
                {/* 桌面显示文字按钮；移动端收成放大镜图标，避免文字挤压 */}
                <Search size={17} aria-hidden className="sm:hidden" />
                <span className="hidden sm:inline">搜索</span>
              </Button>
            </form>
            <p className="mt-4 text-sm text-neutral-500">
              「<span className="font-medium text-neutral-900">{q}</span>」的结果
            </p>
          </div>
        ) : undefined
      }
    >
      <FeedBrowser base="/browse" searchParams={sp} authed={!!u} userId={u?.id} infinite />
    </ArchiveShell>
  );
}
