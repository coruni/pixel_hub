import ResourceGrid from "@/components/resource/ResourceGrid";
import SectionTitle from "@/components/home/SectionTitle";
import { getFeed, type FeedItem } from "@/lib/queries";
import type { CardRatio, ContentDisplay } from "@/lib/display";

const frame = "mx-auto max-w-7xl px-4 sm:px-6";

export type FeaturedBlockCfg = {
  featuredIds: string[];
  display: ContentDisplay;
  ratio: CardRatio;
};

/** 专题板块：手动挑选的资源组成的网格（卡片/列表/瀑布流）；未挑选时自动兜底近期热门 */
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
    items = (await getFeed({ sort: "popular", pageSize: 8 })).items;
  }
  if (items.length === 0) return null;

  // ratio 非 auto（且非 list）：卡片/瀑布统一为所选比例的规整网格
  const ratio = cfg.ratio ?? "auto";
  const uniformRatio = ratio !== "auto" && cfg.display !== "list" ? ratio : undefined;
  const showAs: ContentDisplay = uniformRatio ? "card" : cfg.display;

  return (
    <section className="mt-8">
      <div className={frame}>
        {title && <SectionTitle>{title}</SectionTitle>}
        <ResourceGrid items={items} display={showAs} ratio={uniformRatio} />
      </div>
    </section>
  );
}
