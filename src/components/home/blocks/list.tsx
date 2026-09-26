import ResourceGrid from "@/components/resource/ResourceGrid";
import BlockShell from "@/components/home/BlockShell";
import { getFeed } from "@/lib/queries";
import { getIncentive } from "@/lib/incentive";
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
  /** 追加方式：button=点按钮；infinite=滚近底部自动取。仅 paged=true 时生效 */
  loadMode?: "button" | "infinite";
  ratio: CardRatio;
  /** 排序=最热/最多下载 时的时间窗口 */
  period?: "all" | "week" | "month";
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
  const period = cfg.period && cfg.period !== "all" ? cfg.period : undefined;
  const [{ items }, incentive] = await Promise.all([
    getFeed({
      type: cfg.type,
      sort: cfg.sort,
      pageSize: cfg.count,
      categorySlugs: cfg.categorySlugs,
      tagSlugs: cfg.tagSlugs,
      period,
    }),
    // 昵称色开关：ListMore 是客户端组件，读不到服务端配置，必须在这里取好传下去。
    // getIncentive 走请求级 cache，与页面其它读取共享同一次查询。
    getIncentive(),
  ]);
  if (items.length === 0) return null;

  const ratio = cfg.display === "list" ? undefined : cfg.ratio;
  const nicknameEnabled = incentive.decoration.nicknameEnabled;

  return (
    <BlockShell title={title}>
      <ResourceGrid
        items={items}
        display={cfg.display}
        ratio={ratio}
        nicknameEnabled={nicknameEnabled}
      />
      {cfg.paged && (
        <ListMore
          type={cfg.type}
          sort={cfg.sort}
          categorySlugs={cfg.categorySlugs}
          tagSlugs={cfg.tagSlugs}
          pageSize={cfg.count}
          display={cfg.display}
          ratio={ratio}
          period={period}
          mode={cfg.loadMode ?? "button"}
          nicknameEnabled={nicknameEnabled}
        />
      )}
    </BlockShell>
  );
}
