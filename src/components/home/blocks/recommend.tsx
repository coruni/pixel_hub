import ResourceGrid from "@/components/resource/ResourceGrid";
import BlockShell from "@/components/home/BlockShell";
import { getRecommendations } from "@/lib/queries";
import type { ContentType } from "@/lib/display";

export type RecommendBlockCfg = {
  scope: "personal" | "all";
  mode?: "personalized" | "explore";
  type: "ALL" | ContentType;
  count: number;
  categorySlugs: string[];
  explorationRatio?: number;
  minCategories?: number;
  period?: "all" | "week" | "month";
};

/**
 * 首页「为你推荐」板块：登录用户按用户画像（点赞/收藏/评论/关注，加权+时间衰减）做精准推荐，
 * 并通过探索槽位与多样性选择打破信息茧房；游客回退全站热门。无推荐结果时不渲染，绝不空白。
 */
export default async function RecommendBlock({
  title,
  cfg,
  userId,
  authed,
}: {
  title: string | null;
  cfg: RecommendBlockCfg;
  userId?: string;
  authed?: boolean;
}) {
  const items = await getRecommendations({
    userId: authed ? userId : undefined,
    count: cfg.count,
    scope: authed ? cfg.scope : "all",
    mode: cfg.mode,
    type: cfg.type,
    categorySlugs: cfg.categorySlugs,
    explorationRatio: cfg.explorationRatio,
    minCategories: cfg.minCategories,
    period: cfg.period,
  });
  if (items.length === 0) return null;

  const heading =
    title ??
    (cfg.mode === "explore"
      ? "为你发现"
      : authed && cfg.scope === "personal"
        ? "为你推荐"
        : "热门推荐");

  return (
    <BlockShell title={heading}>
      <ResourceGrid items={items} display="card" ratio="auto" />
    </BlockShell>
  );
}
