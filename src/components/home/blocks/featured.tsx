import ResourceGrid from "@/components/resource/ResourceGrid";
import BlockShell from "@/components/home/BlockShell";
import { getFeed, type FeedItem } from "@/lib/queries";
import type { CardRatio, ContentDisplay } from "@/lib/display";

export type FeaturedBlockCfg = {
  featuredIds: string[];
  display: ContentDisplay;
  ratio: CardRatio;
  period?: "all" | "week" | "month";
};

/** 专题板块：手动挑选的资源组成的网格（卡片网格/列表行）；未挑选时自动兜底近期热门 */
export default async function FeaturedBlock({
  title,
  cfg,
}: {
  title: string | null;
  cfg: FeaturedBlockCfg;
}) {
  const ids = cfg.featuredIds.slice(0, 24);
  let items: FeedItem[];
  if (ids.length > 0) {
    const r = await getFeed({ ids, pageSize: 24 });
    const byId = new Map(r.items.map((i) => [i.id, i]));
    items = ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
  } else {
    items = (
      await getFeed({
        sort: "popular",
        pageSize: 8,
        period: cfg.period && cfg.period !== "all" ? cfg.period : undefined,
      })
    ).items;
  }
  if (items.length === 0) return null;

  // ratio 仅对卡片网格生效（list 行不受比例影响）
  const ratio = cfg.display === "list" ? undefined : cfg.ratio;

  return (
    <BlockShell title={title}>
      <ResourceGrid items={items} display={cfg.display} ratio={ratio} />
    </BlockShell>
  );
}
