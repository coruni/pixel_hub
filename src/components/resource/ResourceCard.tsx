import Link from "next/link";
import {
  Download,
  Film,
  Gamepad2,
  Heart,
  Image as ImageIcon,
  MessageSquare,
  Music,
  Newspaper,
  Star,
} from "lucide-react";
import type { FeedCard } from "@/lib/queries";
import { getIncentive } from "@/lib/incentive";
import { nameColorBrightClass } from "@/lib/decorations";
import { formatCount } from "@/lib/format";
import { CARD_DEFAULT_ASPECT, CARD_RATIOS, TYPE_LABEL, type CardRatio } from "@/lib/display";
import CoverPlaceholder from "./CoverPlaceholder";

/** 类型 → 角标图标/配色；新增类型只改这一张表 */
const TYPE_BADGE = {
  GAME: { Icon: Gamepad2, cls: "text-emerald-300" },
  ARTICLE: { Icon: Newspaper, cls: "text-sky-300" },
  MUSIC: { Icon: Music, cls: "text-brand-300" },
  VIDEO: { Icon: Film, cls: "text-red-300" },
  IMAGE: { Icon: ImageIcon, cls: "text-amber-300" },
} as const;

/**
 * 统一资源卡（信息全覆盖图，无图下白条）：
 * 标题 / 作者·分类 / 赞藏评(·下载) 全部压在封面底部的黑色渐变上，视觉即纯图卡。
 * 封面按 ratio 裁切（默认 3:4 竖版；显式给了 ratio 才换别的比例），同一网格内高度一致。
 */
export default async function ResourceCard({
  item,
  ratio,
}: {
  item: FeedCard;
  ratio?: CardRatio | null;
}) {
  // 昵称特效色：卡片底部是固定黑条，必须用深底专用亮阶（见 decorations.ts 的说明）。
  // getIncentive 走 cache()，同请求内无论多少张卡都只查一次库。
  const incentive = await getIncentive();
  const nickCls = nameColorBrightClass(item.author.nameColor, incentive.decoration.nicknameEnabled);
  const w = item.cover?.width && item.cover.width > 0 ? item.cover.width : 3;
  const h = item.cover?.height && item.cover.height > 0 ? item.cover.height : 2;
  const cover = item.cover;
  const author = item.author.name ?? item.author.username;
  const meta = item.category?.name ?? TYPE_LABEL[item.type] ?? item.type;

  // 显式给定比例 → 按选择裁切；未给/auto → 统一 3:4 竖版
  const boxAspect = (ratio ? CARD_RATIOS[ratio].aspect : undefined) ?? CARD_DEFAULT_ASPECT;

  return (
    <Link
      href={`/resources/${item.slug}`}
      className="group relative block overflow-hidden rounded-none border border-brand-200 bg-neutral-100 transition hover:border-brand-500"
    >
      {/* 封面：aspect div 只定高，图 absolute 铺满 */}
      <div style={{ aspectRatio: boxAspect }}>
        {cover ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={cover.url}
            alt={item.title}
            width={w}
            height={h}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <CoverPlaceholder />
        )}
      </div>

      {/* 左上角类型徽标（图标可辨：游戏 / 文章 / 音乐 / 视频 / 图片，与首页 hero 徽标同风格） */}
      <span
        title={TYPE_LABEL[item.type] ?? item.type}
        className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-none border border-brand-600 bg-stone-900/85 px-1.5 py-0.5 text-[10px] font-medium text-white"
      >
        {(() => {
          const { Icon, cls } = TYPE_BADGE[item.type] ?? TYPE_BADGE.IMAGE;
          return <Icon size={11} className={cls} aria-hidden />;
        })()}
        <span className="sr-only">{TYPE_LABEL[item.type] ?? item.type}</span>
      </span>

      {/* 底部渐变 + 全覆盖信息。遮罩用固定 px 高度（非 %）：卡片统一比例后信息带等高，px 版不随比例变化 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgba(0,0,0,.92)_0px,rgba(0,0,0,.92)_68px,transparent_68px)] px-3 pb-2 pt-9">
        <p className="truncate text-sm font-medium leading-snug text-white drop-shadow">
          {item.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/85">
          <span className={`truncate ${nickCls ?? ""}`}>{author}</span>
          <span className="text-white/45">·</span>
          <span className="shrink-0">{meta}</span>
        </p>
        <div className="mt-1 flex items-center gap-2.5 text-[11px] font-medium text-white/90">
          <span className="inline-flex items-center gap-1">
            <Heart size={11} aria-hidden /> {formatCount(item.likeCount)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Star size={11} aria-hidden /> {formatCount(item.favoriteCount)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare size={11} aria-hidden /> {formatCount(item.commentCount)}
          </span>
          {item.type === "GAME" && (
            <span className="ml-auto inline-flex items-center gap-1 text-emerald-300">
              <Download size={11} aria-hidden /> {formatCount(item.downloadCount)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
