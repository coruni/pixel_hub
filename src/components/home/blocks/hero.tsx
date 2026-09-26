import Link from "next/link";
import {
  ArrowUpRight,
  Download,
  Heart,
  Film,
  Image as ImageIcon,
  Gamepad2,
  Music,
  Newspaper,
} from "lucide-react";
import { getFeed, type FeedItem } from "@/lib/queries";
import { formatCount } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/display";
import Nickname from "@/components/ui/Nickname";
import SectionTitle from "@/components/home/SectionTitle";

const frame = "mx-auto max-w-7xl px-4 sm:px-6";

/** 类型角标：图标 + 中文名，新增类型只需在映射表里加一项 */
const TYPE_ICON = {
  GAME: { Icon: Gamepad2, cls: "text-emerald-300" },
  ARTICLE: { Icon: Newspaper, cls: "text-sky-300" },
  MUSIC: { Icon: Music, cls: "text-brand-300" },
  VIDEO: { Icon: Film, cls: "text-red-300" },
  IMAGE: { Icon: ImageIcon, cls: "text-amber-300" },
} as const;

function TypeBadge({ type }: { type: string }) {
  const { Icon, cls } = TYPE_ICON[type as keyof typeof TYPE_ICON] ?? TYPE_ICON.IMAGE;
  return (
    <span className="inline-flex items-center gap-1 rounded-none border border-brand-600 bg-stone-900/85 px-2 py-1 text-[10px] font-medium text-white">
      <Icon size={11} className={cls} aria-hidden />
      {TYPE_LABEL[type] ?? "资源"}
    </span>
  );
}

export default async function HeroBlock({
  title,
  cfg,
}: {
  title: string | null;
  cfg: {
    featuredIds: string[];
    secondaryDisplay?: "card" | "list";
    secondarySize?: "sm" | "md";
    period?: "all" | "week" | "month";
  };
}) {
  const ids = cfg.featuredIds.slice(0, 5);
  let items: FeedItem[];
  if (ids.length > 0) {
    const r = await getFeed({ ids, pageSize: 5 });
    const byId = new Map(r.items.map((i) => [i.id, i]));
    items = ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
  } else {
    // 未手动挑选：自动展示近期最热，保证首页不空（时间窗口可按板块配置）
    items = (
      await getFeed({
        sort: "popular",
        pageSize: 5,
        period: cfg.period && cfg.period !== "all" ? cfg.period : undefined,
      })
    ).items;
  }
  if (items.length === 0) return null;

  const [big, ...rest] = items;
  // 主推(首图) + 副推 共 5 个：首图固定大图主推，其余 4 个进 4 列副推网格
  // （pc 一行 4 个、移动 2 个）；超出部分自然截断。
  const small = rest.slice(0, 4);
  const secondaryDisplay = cfg.secondaryDisplay ?? "card";
  const secondarySize = cfg.secondarySize ?? "sm";
  const secondaryHeight = secondarySize === "md" ? "h-44 sm:h-56" : "h-36 sm:h-44";
  const listThumb = secondarySize === "md" ? "h-24 w-36 sm:h-28 sm:w-44" : "h-20 w-32 sm:h-24 sm:w-36";

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
                // 首屏主推图是首页 LCP 元素：必须 eager 且**显式提权**。
                // 只写 eager 只表示「不懒加载」，浏览器仍按普通图片排队；fetchPriority="high"
                // 才会把它提到图片队列最前，与字体/首屏 JS 竞争带宽时优先发。
                loading="eager"
                fetchPriority="high"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
              />
            ) : (
              <div className="absolute inset-0 bg-stone-700" />
            )}
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,.88)_0%,rgba(0,0,0,.88)_37%,transparent_37%,transparent_100%)]" />
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
                  {/* 压在固定黑渐变上（深底，不随主题变化）→ tone="dark" */}
                  <Nickname
                    name={big.author.name}
                    username={big.author.username}
                    color={big.author.nameColor}
                    tone="dark"
                  />
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

          {/* 副推（如有）：第一个主推保持大图，后续可在后台切换小卡片/紧凑列表与尺寸 */}
          {small.length > 0 &&
            (secondaryDisplay === "list" ? (
              <div className="grid gap-2">
                {small.map((item) => (
                  <Link
                    key={item.id}
                    href={`/resources/${item.slug}`}
                    className="group flex min-w-0 items-center gap-3 rounded-none border border-brand-200 bg-surface p-2 transition hover:border-brand-500"
                  >
                    <span className={`relative shrink-0 overflow-hidden rounded-none bg-neutral-900 ${listThumb}`}>
                      {item.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.cover.url}
                          alt={item.title}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <span className="absolute inset-0 bg-stone-700" />
                      )}
                      <span className="absolute left-1.5 top-1.5">
                        <TypeBadge type={item.type} />
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-neutral-800 group-hover:text-neutral-950">
                        {item.title}
                      </span>
                      <span className="mt-1 block truncate text-xs text-neutral-400">
                        {/* list 形态是浅底 → 默认 tone="light"，跟随明暗主题 */}
                        <Nickname
                          name={item.author.name}
                          username={item.author.username}
                          color={item.author.nameColor}
                        />
                        {item.category ? ` · ${item.category.name}` : ""}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {small.map((item) => (
                  <Link
                    key={item.id}
                    href={`/resources/${item.slug}`}
                    className={`group relative block overflow-hidden rounded-none border border-brand-200 bg-neutral-900 ${secondaryHeight}`}
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
                    <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,.85)_0%,rgba(0,0,0,.85)_38%,transparent_38%)]" />
                    <div className="absolute left-2 top-2">
                      <TypeBadge type={item.type} />
                    </div>
                    <div className="absolute inset-x-0 bottom-0 p-3">
                      <p className="truncate text-sm font-medium text-white">{item.title}</p>
                      <p className="mt-0.5 truncate text-[11px] text-white/70">
                        {/* 卡片形态同样压黑渐变（深底）→ tone="dark" */}
                        <Nickname
                          name={item.author.name}
                          username={item.author.username}
                          color={item.author.nameColor}
                          tone="dark"
                        />
                        {item.category ? ` · ${item.category.name}` : ""}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}
