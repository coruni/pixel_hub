import Link from "next/link";
import BlockShell from "@/components/home/BlockShell";
import { getTopCreators, type CreatorSort } from "@/lib/home";
import { creatorMetaText } from "@/lib/format";
import type { RankPeriod } from "@/lib/points";
import Avatar from "@/components/ui/Avatar";

export default async function CreatorsBlock({
  title,
  count,
  sort = "followers",
  period = "all",
}: {
  title: string | null;
  count: number;
  sort?: CreatorSort;
  period?: RankPeriod;
}) {
  const creators = await getTopCreators(count, sort, period);
  if (creators.length === 0) return null;

  return (
    <BlockShell title={title}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {creators.map((c) => (
          <Link
            key={c.username}
            href={`/u/${c.username}`}
            className="flex items-center gap-3 rounded-none border border-brand-200 bg-surface p-3 transition hover:border-brand-500"
          >
            <Avatar
              name={c.name}
              username={c.username}
              avatarKey={c.avatarKey}
              size="md"
              online={c.online}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-neutral-800">
                {c.name ?? c.username}
              </span>
              <span className="block truncate text-[11px] text-neutral-400">
                {creatorMetaText(c.resources, c.metric, sort, period)}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </BlockShell>
  );
}
