import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { str, type SP } from "@/lib/search-params";
import FeedBrowser from "@/components/feed/FeedBrowser";
import ArchiveShell from "@/components/feed/ArchiveShell";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SP>;
}): Promise<Metadata> {
  // 带查询词的结果页拒绝索引：防止搜索引擎收录海量低质查询 URL（Google 官方建议）
  const sp = await searchParams;
  const hasQuery = !!str(sp, "q")?.trim();
  return { title: "搜索", ...(hasQuery ? { robots: { index: false, follow: true } } : {}) };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = (await auth())?.user;
  const q = str(sp, "q")?.trim() ?? "";

  return (
    <ArchiveShell
      heading={
        <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
          <form action="/search" method="get" className="flex max-w-xl gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="搜索资源、作者或标签…"
              className="w-full rounded-none border border-brand-200 bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              className="rounded-none border border-brand-600 bg-brand-500 px-5 text-sm font-medium text-white hover:bg-brand-600"
            >
              搜索
            </button>
          </form>
          {q ? (
            <p className="mt-4 text-sm text-neutral-500">
              「<span className="font-medium text-neutral-900">{q}</span>」的结果
            </p>
          ) : (
            <p className="mt-4 text-sm text-neutral-400">
              输入关键词搜索，按标题与简介匹配
            </p>
          )}
        </div>
      }
    >
      {q ? (
        <FeedBrowser base="/search" searchParams={sp} authed={!!u} userId={u?.id} />
      ) : (
        <div className="py-24 text-center text-sm text-neutral-400">输入关键词后展示搜索结果</div>
      )}
    </ArchiveShell>
  );
}
