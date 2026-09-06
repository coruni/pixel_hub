import ResourceGrid from "@/components/resource/ResourceGrid";
import BlockShell from "@/components/home/BlockShell";
import { getFeed } from "@/lib/queries";
import type { CardRatio, ContentDisplay, ContentType } from "@/lib/display";
import ListMore from "./list-more";

export type ListBlockCfg = {
  type: "ALL" | ContentType;
  sort: "latest" | "popular" | "downloads";
  count: number;
  categorySlugs: string[];
  tagSlugs: string[];
  display: ContentDisplay;
  paged: boolean;
  ratio: CardRatio;
};

/**
 * 通用内容板块：类型/排序/每页数量 + 分类与标签多选，卡片网格/列表行，可选「下一页」翻页。
 * ratio 仅对卡片网格生效（list 行不受比例影响）。
 */
export default async function ListBlock({
  title,
  cfg,
}: {
  title: string | null;
  cfg: ListBlockCfg;
}) {
  const { items } = await getFeed({
    type: cfg.type,
    sort: cfg.sort,
    pageSize: cfg.count,
    categorySlugs: cfg.categorySlugs,
    tagSlugs: cfg.tagSlugs,
  });
  if (items.length === 0) return null;

  const ratio = cfg.display === "list" ? undefined : cfg.ratio;

  return (
    <BlockShell title={title}>
      <ResourceGrid items={items} display={cfg.display} ratio={ratio} />
      {cfg.paged && (
        <ListMore
          type={cfg.type}
          sort={cfg.sort}
          categorySlugs={cfg.categorySlugs}
          tagSlugs={cfg.tagSlugs}
          pageSize={cfg.count}
          display={cfg.display}
          ratio={ratio}
        />
      )}
    </BlockShell>
  );
}
