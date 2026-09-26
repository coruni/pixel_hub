import type { Metadata } from "next";
import { Search } from "lucide-react";
import { auth } from "@/lib/auth";
import { getCategories } from "@/lib/queries";
import { str, type SP } from "@/lib/search-params";
import { getSeoConfig, resolveSiteName } from "@/lib/seo-config";
import FeedBrowser from "@/components/feed/FeedBrowser";
import BrowseTitleSync from "@/components/feed/BrowseTitleSync";
import ArchiveShell from "@/components/feed/ArchiveShell";
import { Button } from "@/components/ui/Button";

/**
 * 解析 cat 参数：只有命中真实分类才算数。
 * 无效 slug 一律当作「没选分类」——否则 `/browse?cat=任意串` 会生成一个与 /browse
 * 内容完全相同、却自称独立分类的页面（软 404 + 重复收录）。
 * 与 FeedBrowser 共用 getCategories 的请求级缓存，不会多查一次库。
 */
async function resolveCat(sp: SP) {
  const slug = str(sp, "cat")?.trim();
  if (!slug) return null;
  const cats = await getCategories();
  return cats.find((c) => c.slug === slug) ?? null;
}

/**
 * 规范 URL 只保留解析成功的 cat —— 搜索词/排序/筛选不进 canonical，避免重复内容漂移。
 * **不含 page**：本页开的是无限滚动，FeedBrowser 里 `page` 被写死为 1（追加态只存在于客户端），
 * 所以 `?page=2` 这类 URL 渲染的内容与第 1 页逐条相同，放进 canonical 只会制造重复收录。
 */
function canonicalOf(catSlug: string | null): string {
  return catSlug ? `/browse?cat=${catSlug}` : "/browse";
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
  // 每个分类出各自的 title 与 description：`/browse?cat=X` 在 sitemap 里（daily），
  // 若共用一套标题/描述就会被判重复内容
  const cat = await resolveCat(sp);
  return {
    title: cat ? `${cat.name} · 浏览` : "浏览",
    description: cat
      ? `浏览「${cat.name}」分类下的全部资源，可按类型、时间与热度筛选。`
      : "浏览站内全部资源，可按分类、类型、时间与热度筛选。",
    alternates: { canonical: canonicalOf(cat?.slug ?? null) },
  };
}

export default async function BrowsePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [session, seo] = await Promise.all([auth(), getSeoConfig()]);
  const u = session?.user;
  const q = str(sp, "q")?.trim() ?? "";
  const cat = await resolveCat(sp);
  const pageTitle = q ? "搜索" : cat ? `${cat.name} · 浏览` : "浏览";
  const fullTitle = `${pageTitle} · ${resolveSiteName(seo)}`;
  return (
    <>
      <BrowseTitleSync title={fullTitle} />
      <ArchiveShell
        heading={
        q ? (
          <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
            {/* 搜索态页面 noindex，且可见标题已由搜索框与结果行承担：这里只补一个语义 h1 */}
            <h1 className="sr-only">搜索</h1>
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
        ) : (
          <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
            {/* 列表页必须有 h1：分类名原先进不了正文，只活在 title 与筛选 chip 里 */}
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
              {cat ? cat.name : "浏览"}
            </h1>
          </div>
        )
        }
      >
        <FeedBrowser base="/browse" searchParams={sp} authed={!!u} userId={u?.id} infinite />
      </ArchiveShell>
    </>
  );
}
