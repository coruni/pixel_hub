import FeedBrowser from "@/components/feed/FeedBrowser";
import SectionTitle from "@/components/home/SectionTitle";

type SP = Record<string, string | string[] | undefined>;

export default async function FeedBlock({
  title,
  cfg,
  sp,
  authed,
  userId,
}: {
  title: string | null;
  cfg: { showTags: boolean };
  sp: SP;
  authed?: boolean;
  userId?: string;
}) {
  return (
    <FeedBrowser
      base="/"
      searchParams={sp}
      authed={authed}
      userId={userId}
      showTags={cfg.showTags}
      heading={
        title ? (
          <SectionTitle>{title}</SectionTitle>
        ) : undefined
      }
    />
  );
}
