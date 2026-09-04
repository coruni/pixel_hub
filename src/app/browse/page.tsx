import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import type { SP } from "@/lib/search-params";
import FeedBrowser from "@/components/feed/FeedBrowser";
import ArchiveShell from "@/components/feed/ArchiveShell";

export const metadata: Metadata = { title: "浏览" };

export default async function BrowsePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const u = (await auth())?.user;
  return (
    <ArchiveShell>
      <FeedBrowser base="/browse" searchParams={sp} authed={!!u} userId={u?.id} infinite />
    </ArchiveShell>
  );
}
