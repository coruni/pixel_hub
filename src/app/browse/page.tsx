import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { intParam, str, type SP } from "@/lib/search-params";
import FeedBrowser from "@/components/feed/FeedBrowser";
import ArchiveShell from "@/components/feed/ArchiveShell";

/** 规范 URL 只保留 cat 与 page（page>1）：排序/筛选等参数不进 canonical，避免重复内容漂移 */
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
  return { title: "浏览", alternates: { canonical: canonicalOf(sp) } };
}

export default async function BrowsePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = (await auth())?.user;
  return (
    <ArchiveShell>
      <FeedBrowser base="/browse" searchParams={sp} authed={!!u} userId={u?.id} infinite />
    </ArchiveShell>
  );
}
