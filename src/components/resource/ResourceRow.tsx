import Link from "next/link";
import { Download, Heart } from "lucide-react";
import type { FeedCard } from "@/lib/queries";
import { formatCount } from "@/lib/format";
import CoverPlaceholder from "./CoverPlaceholder";

// 横向「缩略图 + 标题/作者/分类」行卡：用于列表显示形态（首页 list 板块、归档列表、侧栏排行）。
export default function ResourceRow({ item }: { item: FeedCard }) {
  const w = item.cover?.width ?? 3;
  const h = item.cover?.height ?? 2;
  return (
    <Link
      href={`/resources/${item.slug}`}
      className="group flex w-full min-w-0 items-center gap-3 rounded-none border border-brand-200 bg-surface p-2 transition hover:border-brand-500"
    >
      <span className="relative block h-16 w-24 flex-shrink-0 overflow-hidden rounded-none bg-neutral-100">
        {item.cover ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={item.cover.url}
            alt={item.title}
            width={w}
            height={h}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <CoverPlaceholder iconSize={16} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-800 group-hover:text-neutral-950">
          {item.title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-neutral-400">
          {item.author.name ?? item.author.username}
          {item.category ? ` · ${item.category.name}` : ""}
        </span>
        <span className="mt-1 flex items-center gap-2 text-[11px] text-neutral-400">
          <span className="inline-flex items-center gap-0.5">
            <Heart size={10} aria-hidden /> {formatCount(item.likeCount)}
          </span>
          {item.type === "GAME" && (
            <span className="inline-flex items-center gap-0.5">
              <Download size={10} aria-hidden /> {formatCount(item.downloadCount)}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}
