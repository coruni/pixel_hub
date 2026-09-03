import type { FeedCard } from "@/lib/queries";
import type { ContentDisplay, CardRatio } from "@/lib/display";
import ResourceRow from "./ResourceRow";
import ResourceCard from "./ResourceCard";
import MasonryGrid from "./MasonryGrid";

// 按显示形态渲染资源集合：masonry=精确 JS 瀑布流(保原比例、最短列优先) / card=统一比例卡片网格 / list=横向行列表。
export default function ResourceGrid({
  items,
  display,
  className = "",
  ratio,
}: {
  items: FeedCard[];
  display: ContentDisplay;
  className?: string;
  ratio?: CardRatio | null;
}) {
  if (items.length === 0) return null;

  if (display === "list") {
    return (
      <div className={`grid gap-3 ${className}`}>
        {items.map((item) => (
          <ResourceRow key={item.id} item={item} />
        ))}
      </div>
    );
  }

  if (display === "card") {
    // 列数按容器宽（非视口）：带侧栏的主列 ~888px 给 3 列，全宽 1232px 给 4 列，避免窄主列里卡片过挤
    return (
      <div
        className={`@container grid grid-cols-2 gap-4 @[700px]:grid-cols-3 @[1200px]:grid-cols-4 ${className}`}
      >
        {items.map((item) => (
          <ResourceCard key={item.id} item={item} uniform ratio={ratio} />
        ))}
      </div>
    );
  }

  // masonry：精确 JS 瀑布流（SSR 先以 CSS 多列占位，JS 接管后最短列优先）
  return <MasonryGrid items={items} className={className} />;
}
