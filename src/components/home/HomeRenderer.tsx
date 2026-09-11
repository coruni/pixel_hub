import { Fragment, type ReactNode } from "react";
import type { HomeSectionView } from "@/lib/home";
import type { CardRatio } from "@/lib/display";
import type { SP } from "@/lib/search-params";
import { visibleOnClass } from "@/lib/site-config";
import HeroBlock from "./blocks/hero";
import CategoriesBlock from "./blocks/categories";
import ListBlock from "./blocks/list";
import FeaturedBlock from "./blocks/featured";
import FeedBlock from "./blocks/feed";
import StatsBlock from "./blocks/stats";
import CreatorsBlock from "./blocks/creators";
import TagsBlock from "./blocks/tags";
import AdSectionBlock from "./blocks/ad";
import RecommendBlock from "./blocks/recommend";

export default async function HomeRenderer({
  sections,
  sp,
  authed,
  userId,
}: {
  sections: HomeSectionView[];
  sp: SP;
  authed?: boolean;
  userId?: string;
}) {
  const enabled = sections
    .filter((s) => s.enabled && !(s.requireAuth && !authed))
    .sort((a, b) => a.order - b.order);

  const renderSection = (s: HomeSectionView): ReactNode => {
    const cfg = s.config as Record<string, unknown>;
    switch (s.kind) {
      case "hero":
        return (
          <HeroBlock
            key={s.id}
            title={s.title}
            cfg={{
              featuredIds: (cfg.featuredIds as string[]) ?? [],
              period: (cfg.period as "all" | "week" | "month") ?? "all",
            }}
          />
        );
      case "categories":
        return (
          <CategoriesBlock
            key={s.id}
            title={s.title}
            cfg={{
              slugs: (cfg.slugs as string[]) ?? [],
            }}
          />
        );
      case "list":
        return (
          <ListBlock
            key={s.id}
            title={s.title}
            cfg={{
              type: (cfg.type as "ALL" | "IMAGE" | "GAME" | "ARTICLE") ?? "ALL",
              sort: (cfg.sort as "latest" | "popular" | "downloads") ?? "latest",
              count: typeof cfg.count === "number" ? cfg.count : 12,
              categorySlugs: (cfg.categorySlugs as string[]) ?? [],
              tagSlugs: (cfg.tagSlugs as string[]) ?? [],
              display: (cfg.display as "card" | "list") ?? "card",
              paged: cfg.paged === true,
              ratio: (cfg.ratio as CardRatio) ?? "auto",
              period: (cfg.period as "all" | "week" | "month") ?? "all",
            }}
          />
        );
      case "featured":
        return (
          <FeaturedBlock
            key={s.id}
            title={s.title}
            cfg={{
              featuredIds: (cfg.featuredIds as string[]) ?? [],
              display: (cfg.display as "card" | "list") ?? "card",
              ratio: (cfg.ratio as CardRatio) ?? "auto",
              period: (cfg.period as "all" | "week" | "month") ?? "all",
            }}
          />
        );
      case "feed":
        return (
          <FeedBlock
            key={s.id}
            title={s.title}
            cfg={{ showTags: cfg.showTags === true }}
            sp={sp}
            authed={authed}
            userId={userId}
          />
        );
      case "stats":
        return <StatsBlock key={s.id} title={s.title} />;
      case "creators":
        return (
          <CreatorsBlock
            key={s.id}
            title={s.title}
            count={typeof cfg.count === "number" ? cfg.count : 6}
          />
        );
      case "tags":
        return (
          <TagsBlock
            key={s.id}
            title={s.title}
            count={typeof cfg.count === "number" ? cfg.count : 12}
            slugs={(cfg.slugs as string[]) ?? []}
          />
        );
      case "ad":
        // 广告位：无标题外壳，未配置（无图无代码）时板块返回 null
        return (
          <AdSectionBlock
            key={s.id}
            cfg={{
              mode: cfg.mode === "html" ? "html" : "image",
              image: typeof cfg.image === "string" ? cfg.image : "",
              link: typeof cfg.link === "string" ? cfg.link : "",
              alt: typeof cfg.alt === "string" ? cfg.alt : "",
              html: typeof cfg.html === "string" ? cfg.html : "",
              badge: cfg.badge !== false,
            }}
          />
        );
      case "recommend":
        return (
          <RecommendBlock
            key={s.id}
            title={s.title}
            userId={userId}
            authed={authed}
            cfg={{
              scope: (cfg.scope as "personal" | "all") ?? "personal",
              mode: (cfg.mode as "personalized" | "explore") ?? "personalized",
              type: (cfg.type as "ALL" | "IMAGE" | "GAME" | "ARTICLE") ?? "ALL",
              count: typeof cfg.count === "number" ? cfg.count : 12,
              categorySlugs: (cfg.categorySlugs as string[]) ?? [],
              explorationRatio:
                typeof cfg.explorationRatio === "number" ? cfg.explorationRatio : 0.3,
              minCategories: typeof cfg.minCategories === "number" ? cfg.minCategories : 0,
              period: (cfg.period as "all" | "week" | "month") ?? "all",
            }}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      {enabled.map((s) => {
        const cls = visibleOnClass(s.visibleOn);
        const node = renderSection(s);
        return cls ? <div key={s.id} className={cls}>{node}</div> : <Fragment key={s.id}>{node}</Fragment>;
      })}
    </>
  );
}
