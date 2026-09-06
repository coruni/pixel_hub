import { getFeed, getRandomResourceIds, type FeedItem } from "@/lib/queries";
import { widgetTitle, type SidebarWidget } from "@/lib/site-config";
import { WidgetShell, type DetailWidgetCtx } from "../shell";
import { MiniCard, MiniRow, type MetricKind } from "../mini";

/** 内容流类侧边栏组件：热门排行 / 随机推荐 / 作者其它作品 / 同分类推荐 */

export async function renderHot(w: SidebarWidget) {
  const cfg = w.config as {
    type: "ALL" | "IMAGE" | "GAME";
    sort: "latest" | "popular" | "downloads";
    count: number;
    display: "card" | "list";
  };
  const { items } = await getFeed({
    type: cfg.type === "ALL" ? undefined : cfg.type,
    sort: cfg.sort,
    pageSize: cfg.count,
  });
  if (items.length === 0) return null;

  const compact = cfg.display !== "list";
  // 排行指标随排序走：popular 看点赞、downloads 看下载、latest 看浏览
  const metric: MetricKind =
    cfg.sort === "popular" ? "likes" : cfg.sort === "downloads" ? "downloads" : "views";
  return (
    <WidgetShell title={widgetTitle(w)}>
      <div className={compact ? "grid grid-cols-2 gap-2" : "grid gap-1"}>
        {items.map((item, i) =>
          compact ? (
            <MiniCard key={item.id} item={item} rank={i + 1} metric={metric} />
          ) : (
            <MiniRow key={item.id} item={item} rank={i + 1} metric={metric} />
          ),
        )}
      </div>
    </WidgetShell>
  );
}

// ---------- 随机推荐（手气不错） ----------

export async function renderRandom(w: SidebarWidget) {
  const cfg = w.config as { count: number };
  const ids = await getRandomResourceIds(cfg.count);
  if (ids.length === 0) return null;
  const { items } = await getFeed({ ids, pageSize: cfg.count });
  if (items.length === 0) return null;

  return (
    <WidgetShell title={widgetTitle(w)}>
      <div className="grid gap-2">
        {items.map((item) => (
          <MiniRow key={item.id} item={item} />
        ))}
      </div>
      <p className="mt-2 text-center text-[10px] text-neutral-400">每次刷新随机换一批</p>
    </WidgetShell>
  );
}

// ---------- 作者其它作品（详情页专用） ----------

export async function renderAuthorWorks(w: SidebarWidget, detail?: DetailWidgetCtx) {
  if (!detail) return null;
  const cfg = w.config as { count: number };
  // 多取 1 条抵掉当前资源自身
  const { items } = await getFeed({
    authorUsername: detail.authorUsername,
    sort: "popular",
    pageSize: cfg.count + 1,
  });
  const list = items.filter((i) => i.id !== detail.id).slice(0, cfg.count);
  if (list.length === 0) return null;

  return (
    <WidgetShell title={widgetTitle(w)}>
      <div className="grid gap-1">
        {list.map((item) => (
          <MiniRow key={item.id} item={item} />
        ))}
      </div>
    </WidgetShell>
  );
}

// ---------- 同分类推荐（详情页专用） ----------
// 同分类热门优先，不足补同类型热门（取数模式同 queries.getRelated，条数可配）

export async function renderSameCategory(w: SidebarWidget, detail?: DetailWidgetCtx) {
  if (!detail) return null;
  const cfg = w.config as { count: number };
  const seen = new Set<string>([detail.id]);
  const out: FeedItem[] = [];
  const add = (items: typeof out) => {
    for (const i of items) {
      if (out.length >= cfg.count) break;
      if (!seen.has(i.id)) {
        seen.add(i.id);
        out.push(i);
      }
    }
  };
  if (detail.categorySlug) {
    const { items } = await getFeed({
      categorySlug: detail.categorySlug,
      sort: "popular",
      pageSize: cfg.count,
    });
    add(items);
  }
  if (out.length < cfg.count) {
    // 同类型热门池取大一点，过滤掉已占位后仍有余量
    const { items } = await getFeed({
      type: detail.type,
      sort: "popular",
      pageSize: cfg.count * 2,
    });
    add(items);
  }
  if (out.length === 0) return null;

  return (
    <WidgetShell title={widgetTitle(w)}>
      <div className="grid gap-1">
        {out.map((item) => (
          <MiniRow key={item.id} item={item} />
        ))}
      </div>
    </WidgetShell>
  );
}
