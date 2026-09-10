import Link from "next/link";
import type { ReactNode } from "react";
import { getCategories, getFeed, getTopTags, toFeedCard } from "@/lib/queries";
import { enumParam, intParam, str, type SP } from "@/lib/search-params";
import { FEED_PAGE_SIZE } from "@/lib/feed-paging";
import ResourceGrid from "@/components/resource/ResourceGrid";
import FeedPager from "@/components/feed/FeedPager";
import FeedInfinite from "@/components/feed/FeedInfinite";

type Props = {
  base: string; // 当前页路径
  searchParams: SP;
  authed?: boolean;
  userId?: string;
  heading?: ReactNode;
  showTags?: boolean;
  /** true = 无限滚动替代数字分页（当前仅 /browse 使用） */
  infinite?: boolean;
};

export default async function FeedBrowser({
  base,
  searchParams,
  authed,
  userId,
  heading,
  showTags,
  infinite,
}: Props) {
  const sp = searchParams;
  const type = enumParam(sp, "type", ["ALL", "GAME", "IMAGE", "ARTICLE"] as const, "ALL");
  const cat = str(sp, "cat");
  const tag = str(sp, "tag");
  const sort = enumParam(sp, "sort", ["latest", "popular", "downloads"] as const, "latest");
  const period = enumParam(sp, "period", ["all", "day", "week", "month"] as const, "all");
  const q = str(sp, "q")?.trim();
  const follow = str(sp, "follow") === "1" && !!authed && !!userId;
  // 无限滚动无 URL 页码：始终从第 1 页起，追加态只存在客户端
  const page = infinite ? 1 : intParam(sp, "page", 1);

  // 板块顶部锚点 id（翻页后滚到这里）：按当前路径生成唯一 id，避免同页出现多个分页模块时冲突
  const moduleId =
    (base === "/"
      ? "home"
      : base
          .replace(/^\/+/, "")
          .replace(/[^a-zA-Z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")) + "-feed";

  const [categories, feed, topTags] = await Promise.all([
    getCategories(),
    getFeed({
      type,
      categorySlug: follow ? undefined : cat,
      tagSlug: follow ? undefined : tag,
      sort,
      period,
      q: follow ? undefined : q,
      followOnlyOf: follow ? userId : undefined,
      page,
      pageSize: FEED_PAGE_SIZE,
    }),
    // 热门标签仅浏览页需要，其余页直接空数组
    showTags ? getTopTags() : Promise.resolve([] as Awaited<ReturnType<typeof getTopTags>>),
  ]);
  const { items, hasMore } = feed;
  const emptyText = follow
    ? "关注的作者还没有新内容"
    : q
      ? `没有找到与「${q}」相关的内容`
      : "这里还没有内容";

  // 构造过滤链接
  function href(patch: Record<string, string | null>): string {
    const usp = new URLSearchParams();
    // 切换大类 / 关注 Tab 时清掉分类、标签等从属筛选，其余情况保留当前筛选
    const switchingTab = patch.type !== undefined || patch.follow !== undefined;
    if (!switchingTab) {
      if (cat) usp.set("cat", cat);
      if (tag) usp.set("tag", tag);
      if (follow) usp.set("follow", "1");
    }
    const nextType = patch.type === undefined ? type : patch.type;
    if (nextType && nextType !== "ALL") usp.set("type", nextType);
    const keep = { sort, period, q } as Record<string, string | undefined>;
    for (const [k, v] of Object.entries(keep)) if (v) usp.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      // 无限滚动不写 page 参数（页码只在客户端追加态里前进）
      if (infinite && k === "page") continue;
      if (v === null) usp.delete(k);
      else if (k !== "type" && k !== "follow") usp.set(k, v);
      else if (k === "follow") {
        if (v === "1") usp.set("follow", "1");
        else usp.delete("follow");
      }
    }
    // 分页翻页/筛选换集合时的页码处理：无限滚动不需要页码参数（追加态在客户端）
    if (!infinite) {
      // 分类/标签切换会改变当前列表集合，页码应回到第 1 页；纯排序/时间调整保留原页位置
      if (patch.page) usp.set("page", patch.page);
      else if ("cat" in patch || "tag" in patch) usp.set("page", "1");
      else if (!("follow" in patch)) usp.set("page", String(page));
    }
    const qs = usp.toString();
    return qs ? `${base}?${qs}` : base;
  }

  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-none border px-3 py-1 text-xs transition ${
      active
        ? "border-brand-600 bg-brand-500 text-white"
        : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-500"
    }`;

  // 换筛选 = 换 URL，server 端按新 searchParams 取回首屏；但客户端软导航不会卸载本组件，
  // FeedInfinite 内部 useState(initial) 只在挂载时生效 —— 用 key 把筛选组合钉进组件身份，
  // 筛选项一变即强制以新首屏重挂（追加态/滚动观察器一并清空）。
  const feedKey = `${type}|${sort}|${period}|${cat ?? ""}|${tag ?? ""}|${q ?? ""}|${
    follow ? "1" : "0"
  }`;

  // 无限滚动：首屏注入客户端流，后续页由 IntersectionObserver 自动追加；否则数字分页
  const feedArea = infinite ? (
    <FeedInfinite
      key={feedKey}
      initial={items.map(toFeedCard)}
      initialHasMore={hasMore}
      params={{
        type,
        sort,
        period,
        categorySlug: follow ? undefined : cat || undefined,
        tagSlug: follow ? undefined : tag || undefined,
        q: follow ? undefined : q || undefined,
        follow,
      }}
      emptyText={emptyText}
    />
  ) : (
    <>
      <ResourceGrid
        className="mt-4"
        items={items.map(toFeedCard)}
        display="card"
        ratio="3:4"
      />
      {items.length === 0 && (
        <div className="mt-20 text-center text-sm text-neutral-400">{emptyText}</div>
      )}
      {/* 分页：上一页/下一页点击后滚动到板块顶部（见 FeedPager） */}
      <FeedPager
        moduleId={moduleId}
        prevHref={page > 1 ? href({ page: String(page - 1) }) : null}
        nextHref={hasMore ? href({ page: String(page + 1) }) : null}
        page={page}
      />
    </>
  );

  return (
    <div id={moduleId} className="mx-auto max-w-7xl scroll-mt-20 px-4 py-6 sm:px-6">
      {heading}

      {/* 主 Tab：类型 + 关注 */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: "ALL", label: "全部" },
          { key: "IMAGE", label: "图片" },
          { key: "GAME", label: "游戏" },
          { key: "ARTICLE", label: "文章" },
        ].map((t) => (
          <Link
            key={t.key}
            scroll={false}
            href={href({ type: t.key, page: "1", follow: null })}
            className={chip(!follow && type === t.key)}
          >
            {t.label}
          </Link>
        ))}
        {authed && userId && (
          <Link scroll={false} href={href({ follow: "1", page: "1" })} className={chip(follow)}>
            关注
          </Link>
        )}
        <span className="mx-2 h-4 w-px bg-neutral-300" />
        {q ? (
          // 全文检索态：结果按相关度排序（引擎相关度），不再提供 最新/最热 等字段排序切换
          <span className="flex items-center text-xs text-neutral-500">按相关度排序</span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs">
            <Link
              scroll={false}
              href={href({ sort: "latest" })}
              className={
                sort === "latest"
                  ? "font-semibold text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-800"
              }
            >
              最新
            </Link>
            <Link
              scroll={false}
              href={href({ sort: "popular" })}
              className={
                sort === "popular"
                  ? "font-semibold text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-800"
              }
            >
              最热
            </Link>
            <Link
              scroll={false}
              href={href({ sort: "downloads" })}
              className={
                sort === "downloads"
                  ? "font-semibold text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-800"
              }
            >
              最多下载
            </Link>
          </span>
        )}
        <span className="mx-1 text-neutral-300">|</span>
        <span className="flex items-center gap-1.5 text-xs">
          {(["all", "day", "week", "month"] as const).map((p) => (
            <Link
              key={p}
              scroll={false}
              href={href({ period: p })}
              className={
                period === p
                  ? "font-semibold text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-800"
              }
            >
              {p === "all" ? "全部时间" : p === "day" ? "今天" : p === "week" ? "本周" : "本月"}
            </Link>
          ))}
        </span>
      </div>

      {/* 分类全类型通用，不随内容类型 tab 过滤：默认收起（只显示前 8 个），超出的收进「更多」原生展开，选中项始终可见 */}
      {!follow &&
        categories.length > 0 &&
        (() => {
          const CATS_VISIBLE = 8;
          // 选中的分类若落在折叠区，把它换到可见区末位展示
          const activeIdx = categories.findIndex((c) => cat === c.slug);
          const visible = categories.slice(0, CATS_VISIBLE);
          const rest = categories.slice(CATS_VISIBLE);
          if (activeIdx >= CATS_VISIBLE) {
            const active = categories[activeIdx];
            visible[visible.length - 1] = active;
            rest[activeIdx - CATS_VISIBLE] = categories[CATS_VISIBLE - 1];
          }
          return (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-neutral-400">分类</span>
              <Link scroll={false} href={href({ cat: null })} className={chip(!cat)}>
                全部分类
              </Link>
              {visible.map((c) => (
                <Link
                  key={c.id}
                  scroll={false}
                  href={href({ cat: c.slug })}
                  className={chip(cat === c.slug)}
                >
                  {c.name}
                </Link>
              ))}
              {rest.length > 0 && (
                <details className="group flex w-full flex-wrap items-center gap-1.5">
                  <summary
                    className={`${chip(false)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
                  >
                    {/* 展开后按钮文案切换为「收起」 */}
                    <span className="group-open:hidden">+{rest.length} 个分类</span>
                    <span className="hidden group-open:inline">收起分类</span>
                  </summary>
                  <div className="w-full">
                    {rest.map((c) => (
                      <Link
                        key={c.id}
                        scroll={false}
                        href={href({ cat: c.slug })}
                        className={`${chip(cat === c.slug)} mr-1.5 inline-block`}
                      >
                        {c.name}
                      </Link>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })()}

      {/* 热门标签（浏览页） */}
      {!follow && showTags && topTags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-neutral-400">热门标签：</span>
          {topTags.slice(0, 14).map((t) => (
            <Link
              key={t.slug}
              href={`/tags/${t.slug}`}
              className="text-neutral-500 hover:text-neutral-900"
            >
              #{t.name}
            </Link>
          ))}
        </div>
      )}

      {/* 内容区：统一 3:4 竖版卡片网格 —— 无限滚动(客户端流)或数字分页（见 feedArea） */}
      {feedArea}
    </div>
  );
}
