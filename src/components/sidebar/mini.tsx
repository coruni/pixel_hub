import Link from "next/link";
import { Download, Eye, Heart } from "lucide-react";
import type { FeedItem } from "@/lib/queries";
import { formatCount } from "@/lib/format";

/** 侧边栏迷你内容项（排行/随机/作者作品等列表通用）：名次徽标 + 缩略图 + 指标 */

const METRIC_META = {
  likes: { icon: Heart, label: "赞" },
  downloads: { icon: Download, label: "下载" },
  views: { icon: Eye, label: "浏览" },
} as const;
export type MetricKind = keyof typeof METRIC_META;

function metricOf(item: FeedItem, metric: MetricKind) {
  return metric === "likes" ? item.likeCount : metric === "downloads" ? item.downloadCount : item.viewCount;
}

export function MetricText({ item, metric }: { item: FeedItem; metric: MetricKind }) {
  const { icon: Icon, label } = METRIC_META[metric];
  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-neutral-400" title={`${label} ${metricOf(item, metric)}`}>
      <Icon size={10} aria-hidden />
      {formatCount(metricOf(item, metric))}
    </span>
  );
}

// 前三名实心高亮，其余浅底（卡片模式压在缩略图上时反色）
function RankBadge({ rank, overlay = false }: { rank: number; overlay?: boolean }) {
  const top = rank <= 3;
  return (
    <span
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-none text-[11px] font-semibold tabular-nums ${top
        ? "border border-brand-600 bg-brand-500 text-white"
        : overlay
          ? "bg-black/50 text-white/80"
          : "bg-brand-50 text-brand-300"
        }`}
    >
      {rank}
    </span>
  );
}

function MiniThumb({ item, className = "" }: { item: FeedItem; className?: string }) {
  return (
    <span className={`relative block overflow-hidden bg-neutral-100 ${className}`}>
      {item.cover ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={item.cover.url}
          alt={item.title}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center bg-brand-50 text-sm font-semibold text-brand-300">
          {(item.title ?? "?").slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/** 列表行：缩略图横排 */
export function MiniRow({ item, rank, metric }: { item: FeedItem; rank?: number; metric?: MetricKind }) {
  return (
    <Link href={`/resources/${item.slug}`} className="group flex items-center gap-2.5 rounded-none p-1 transition hover:bg-brand-50">
      {rank != null && <RankBadge rank={rank} />}
      <MiniThumb item={item} className="h-11 w-16 shrink-0 rounded-none" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-neutral-800 group-hover:text-neutral-950">{item.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-400">
          <span className="truncate">{item.author.name ?? item.author.username}</span>
          {item.type === "GAME" && <span className="rounded-none bg-emerald-50 px-1 text-[9px] font-medium text-emerald-600">游戏</span>}
          {item.type === "ARTICLE" && <span className="rounded-none bg-sky-50 px-1 text-[9px] font-medium text-sky-600">文章</span>}
          {metric && <span className="ml-auto"><MetricText item={item} metric={metric} /></span>}
        </span>
      </span>
    </Link>
  );
}

/** 小卡片：竖排缩略图（compact 网格用） */
export function MiniCard({ item, rank, metric }: { item: FeedItem; rank?: number; metric?: MetricKind }) {
  return (
    <Link href={`/resources/${item.slug}`} className="group block overflow-hidden rounded-none border border-brand-200/70 transition hover:border-brand-500">
      <span className="relative block">
        <MiniThumb item={item} className="aspect-[4/3] w-full" />
        {rank != null && (
          <span className="absolute left-0 top-0">
            <RankBadge rank={rank} overlay />
          </span>
        )}
      </span>
      <span className="block px-1.5 py-1">
        <span className="block truncate text-[11px] font-medium text-neutral-800">{item.title}</span>
        <span className="mt-0.5 flex items-center justify-between gap-1">
          <span className="truncate text-[10px] text-neutral-400">{item.author.name ?? item.author.username}</span>
          {metric && <MetricText item={item} metric={metric} />}
        </span>
      </span>
    </Link>
  );
}
