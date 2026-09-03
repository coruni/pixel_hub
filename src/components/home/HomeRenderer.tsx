import type { HomeSectionView } from "@/lib/home";
import type { CardRatio } from "@/lib/display";
import HeroBlock from "./blocks/hero";
import CategoriesBlock from "./blocks/categories";
import ListBlock from "./blocks/list";
import FeaturedBlock from "./blocks/featured";
import FeedBlock from "./blocks/feed";
import StatsBlock from "./blocks/stats";
import CreatorsBlock from "./blocks/creators";
import TagsBlock from "./blocks/tags";

type SP = Record<string, string | string[] | undefined>;

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
  const enabled = sections.filter((s) => s.enabled).sort((a, b) => a.order - b.order);

  return (
    <>
      {enabled.map((s) => {
        const cfg = s.config as Record<string, unknown>;
        switch (s.kind) {
          case "hero":
            return <HeroBlock key={s.id} title={s.title} cfg={{ featuredIds: (cfg.featuredIds as string[]) ?? [] }} />;
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
                  display: (cfg.display as "card" | "list" | "masonry") ?? "masonry",
                  paged: cfg.paged === true,
                  ratio: (cfg.ratio as CardRatio) ?? "auto",
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
                  display: (cfg.display as "card" | "list" | "masonry") ?? "card",
                  ratio: (cfg.ratio as CardRatio) ?? "auto",
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
            return <CreatorsBlock key={s.id} title={s.title} count={typeof cfg.count === "number" ? cfg.count : 6} />;
          case "tags":
            return (
              <TagsBlock
                key={s.id}
                title={s.title}
                count={typeof cfg.count === "number" ? cfg.count : 12}
                slugs={(cfg.slugs as string[]) ?? []}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}
