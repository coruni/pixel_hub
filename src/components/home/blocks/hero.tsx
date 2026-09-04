import Link from "next/link";
import {
  ArrowUpRight,
  Download,
  Heart,
  Image as ImageIcon,
  Gamepad2,
  Newspaper,
} from "lucide-react";
import { getFeed, type FeedItem } from "@/lib/queries";
import { formatCount } from "@/lib/format";
import SectionTitle from "@/components/home/SectionTitle";

const frame = "mx-auto max-w-7xl px-4 sm:px-6";

function TypeBadge({ type }: { type: "GAME" | "IMAGE" | "ARTICLE" }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-none border border-brand-600 bg-stone-900/85 px-2 py-1 text-[10px] font-medium text-white">
      {type === "GAME" ? (
        <Gamepad2 size={11} className="text-emerald-300" aria-hidden />
      ) : type === "ARTICLE" ? (
        <Newspaper size={11} className="text-sky-300" aria-hidden />
      ) : (
        <ImageIcon size={11} className="text-amber-300" aria-hidden />
      )}
      {type === "GAME" ? "游戏" : type === "ARTICLE" ? "文章" : "图片"}
    </span>
  );
}

export default async function HeroBlock({
  title,
  cfg,
}: {
  title: string | null;
  cfg: { featuredIds: string[] };
}) {
  const ids = cfg.featuredIds.slice(0, 8);
  let items: FeedItem[];
  if (ids.length > 0) {
    const r = await getFeed({ ids, pageSize: 8 });
    const byId = new Map(r.items.map((i) => [i.id, i]));
    items = ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
  } else {
    // 未手动挑选：自动展示近期最热，保证首页不空
    items = (await getFeed({ sort: "popular", pageSize: 4 })).items;
  }
  if (items.length === 0) return null;

  const [big, ...rest] = items;
  const small = rest.slice(0, 3);

  return (
    <section className="pt-8">
      <div className={frame}>
        {title && <SectionTitle as="h1">{title}</SectionTitle>}
        <div className="flex flex-col gap-3">
          {/* 大图主推 */}
          <Link
            href={`/resources/${big.slug}`}
            className="group relative block h-64 overflow-hidden rounded-none border border-brand-200 bg-neutral-900 sm:h-80"
          >
            {big.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={big.cover.url}
                alt={big.title}
                loading="eager"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
              />
            ) : (
              <div className="absolute inset-0 bg-stone-700" />
            )}
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,.88)_0%,rgba(0,0,0,.88)_52%,rgba(0,0,0,.45)_52%,rgba(0,0,0,.45)_72%,transparent_72.5%)]" />
            <div className="absolute left-3 top-3">
              <TypeBadge type={big.type} />
            </div>

            <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-5">
              <div className="min-w-0">
                <p className="text-xl font-semibold text-white sm:text-2xl">{big.title}</p>
                {big.summary && (
                  <p className="mt-1 hidden max-w-xl truncate text-sm text-white/80 sm:block">
                    {big.summary}
                  </p>
                )}
                <p className="mt-2 flex items-center gap-2 text-xs text-white/75">
                  <span>{big.author.name ?? big.author.username}</span>
                  {big.category && <span>· {big.category.name}</span>}
                  <span className="inline-flex items-center gap-1">
                    <Heart size={12} />
                    {formatCount(big.likeCount)}
                  </span>
                  {big.type === "GAME" && (
                    <span className="inline-flex items-center gap-1">
                      <Download size={12} />
                      {formatCount(big.downloadCount)}
                    </span>
                  )}
                </p>
              </div>
              <span className="hidden items-center gap-1 rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition group-hover:bg-brand-600 sm:inline-flex">
                查看详情 <ArrowUpRight size={14} />
              </span>
            </div>
          </Link>

          {/* 副推（如有） */}
          {small.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {small.map((item) => (
                <Link
                  key={item.id}
                  href={`/resources/${item.slug}`}
                  className="group relative block h-36 overflow-hidden rounded-none border border-brand-200 bg-neutral-900 sm:h-44"
                >
                  {item.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.cover.url}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-stone-700" />
                  )}
                  <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,.85)_0%,rgba(0,0,0,.85)_50%,transparent_50.5%)]" />
                  <div className="absolute left-2 top-2">
                    <TypeBadge type={item.type} />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <p className="truncate text-sm font-medium text-white">{item.title}</p>
                    <p className="mt-0.5 truncate text-[11px] text-white/70">
                      {item.author.name ?? item.author.username}
                      {item.category ? ` · ${item.category.name}` : ""}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
