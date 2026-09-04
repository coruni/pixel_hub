import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getCategories, getRecentComments, getTagsBySlugs, getTopTags } from "@/lib/queries";
import { getTopCreators } from "@/lib/home";
import { widgetTitle, type SidebarWidget } from "@/lib/site-config";
import { formatCount, timeAgo } from "@/lib/format";
import { isOnline } from "@/lib/online";
import Avatar from "@/components/ui/Avatar";
import { WidgetShell } from "../shell";

/** 名单类侧边栏组件：分类入口 / 标签云 / 人气创作者 / 最新评论 */

export async function renderCategories(w: SidebarWidget) {
  const cfg = w.config as { slugs: string[] };
  const categories = await getCategories();
  let list = categories;
  if (cfg.slugs.length > 0) {
    const set = new Set(cfg.slugs);
    const sel = list.filter((c) => set.has(c.slug));
    if (sel.length > 0) list = sel;
  }
  if (list.length === 0) return null;

  return (
    <WidgetShell title={widgetTitle(w)}>
      <ul className="space-y-0.5">
        {list.map((c) => (
          <li key={c.id}>
            <Link
              href={`/browse?cat=${c.slug}`}
              className="group flex items-center gap-2 rounded-none px-2 py-1.5 text-sm text-neutral-600 transition hover:bg-brand-50 hover:text-neutral-900"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-none border border-brand-600 bg-brand-500 text-[11px] font-semibold text-white">
                {(c.name ?? "?").slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <ArrowUpRight
                size={12}
                className="text-neutral-300 transition group-hover:text-neutral-500"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </WidgetShell>
  );
}

export async function renderTags(w: SidebarWidget) {
  const cfg = w.config as { count: number; slugs: string[] };
  let tags: { slug: string; name: string; count: number }[];
  if (cfg.slugs.length > 0) {
    tags = await getTagsBySlugs(cfg.slugs);
    if (tags.length === 0) return null;
  } else {
    tags = await getTopTags(cfg.count);
    if (tags.length === 0) return null;
  }

  return (
    <WidgetShell title={widgetTitle(w)}>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <Link
            key={t.slug}
            href={`/tags/${t.slug}`}
            className="rounded-none border border-brand-200 px-2.5 py-1 text-xs text-neutral-600 transition hover:border-brand-500 hover:text-brand-700"
          >
            #{t.name}
          </Link>
        ))}
      </div>
    </WidgetShell>
  );
}

export async function renderCreators(w: SidebarWidget) {
  const cfg = w.config as { count: number };
  const creators = await getTopCreators(cfg.count);
  if (creators.length === 0) return null;
  return (
    <WidgetShell title={widgetTitle(w)}>
      <ul className="space-y-0.5">
        {creators.map((c) => (
          <li key={c.username}>
            <Link
              href={`/u/${c.username}`}
              className="group flex items-center gap-2.5 rounded-none px-2 py-1.5 transition hover:bg-brand-50"
            >
              <Avatar
                name={c.name}
                username={c.username}
                avatarKey={c.avatarKey}
                size="sm"
                online={c.online}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-800 group-hover:text-neutral-950">
                  {c.name ?? c.username}
                </span>
                <span className="block truncate text-[11px] text-neutral-400">
                  {c.resources} 作品 · {formatCount(c.followers)} 粉丝
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </WidgetShell>
  );
}

export async function renderComments(w: SidebarWidget) {
  const cfg = w.config as { count: number };
  const rows = await getRecentComments(cfg.count);
  if (rows.length === 0) return null;

  return (
    <WidgetShell title={widgetTitle(w)}>
      <ul className="space-y-2.5">
        {rows.map((c) => (
          <li key={c.id} className="flex gap-2">
            <Avatar
              name={c.author.name}
              username={c.author.username}
              avatarKey={c.author.avatarKey}
              size="xs"
              online={isOnline(c.author.lastSeenAt)}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5">
                <span className="truncate text-xs font-medium text-neutral-800">
                  {c.author.name ?? c.author.username}
                </span>
                <span className="shrink-0 text-[10px] text-neutral-300">
                  {timeAgo(c.createdAt)}
                </span>
              </span>
              <Link
                href={`/resources/${c.resource.slug}`}
                className="mt-0.5 block truncate text-xs leading-5 text-neutral-500 hover:text-neutral-800"
                title={c.content}
              >
                {c.content}
              </Link>
              <span className="mt-0.5 block truncate text-[10px] text-neutral-400">
                于「{c.resource.title}」
              </span>
            </span>
          </li>
        ))}
      </ul>
    </WidgetShell>
  );
}
