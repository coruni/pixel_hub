import type { FeedCard } from "@/lib/queries";
import type { ContentDisplay, CardRatio } from "@/lib/display";
import ResourceRow from "./ResourceRow";
import ResourceCard from "./ResourceCard";

// 按显示形态渲染资源集合：card=统一比例卡片网格(默认 3:4，可显式传 ratio) / list=横向行列表。
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

  // card：列数用标准视口断点：移动 2 / md(iPad) 3 / lg(PC) 4
  return (
    <div className={`grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 ${className}`}>
      {items.map((item) => (
        <ResourceCard key={item.id} item={item} ratio={ratio} />
      ))}
    </div>
  );
}
