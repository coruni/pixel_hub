import ResourceGrid from "@/components/resource/ResourceGrid";
import { getFeed } from "@/lib/queries";
import type { CardRatio, ContentDisplay, ContentType } from "@/lib/display";
import ListMore from "./list-more";
import ListMasonry from "./list-masonry";
import SectionTitle from "@/components/home/SectionTitle";

const frame = "mx-auto max-w-7xl px-4 sm:px-6";

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
 * 通用内容板块：类型/排序/每页数量 + 分类与标签多选，卡片/列表/瀑布流，可选「下一页」翻页。
 * ratio 非 auto（且非 list 形态）时：把卡片/瀑布统一渲染为「所选比例的规整卡片网格」——
 * 瀑布流 + 固定比例本质就是整齐网格；list 行不受比例影响。
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

  const ratio = cfg.ratio ?? "auto";
  const uniformRatio = ratio !== "auto" && cfg.display !== "list" ? ratio : undefined;
  const showAs: ContentDisplay = uniformRatio ? "card" : cfg.display;

  // 真正的瀑布流 + 允许翻页：交由客户端一体化管理，后续页追加进同一条瀑布流
  if (showAs === "masonry" && cfg.paged) {
    return (
      <ListMasonry
        title={title}
        initial={items}
        type={cfg.type}
        sort={cfg.sort}
        categorySlugs={cfg.categorySlugs}
        tagSlugs={cfg.tagSlugs}
        pageSize={cfg.count}
      />
    );
  }

  return (
    <section className="mt-8">
      <div className={frame}>
        {title && <SectionTitle>{title}</SectionTitle>}
        <ResourceGrid items={items} display={showAs} ratio={uniformRatio} />
        {cfg.paged && (
          <ListMore
            type={cfg.type}
            sort={cfg.sort}
            categorySlugs={cfg.categorySlugs}
            tagSlugs={cfg.tagSlugs}
            pageSize={cfg.count}
            display={showAs}
            ratio={uniformRatio}
          />
        )}
      </div>
    </section>
  );
}
