import Link from "next/link";
import {
  Download,
  Gamepad2,
  Heart,
  Image as ImageIcon,
  MessageSquare,
  Newspaper,
  Star,
} from "lucide-react";
import type { FeedCard } from "@/lib/queries";
import { formatCount } from "@/lib/format";
import { CARD_RATIOS, TYPE_LABEL, clampedAspect, type CardRatio } from "@/lib/display";

/**
 * 统一资源卡（信息全覆盖图，无图下白条）：
 * 标题 / 作者·分类 / 赞藏评(·下载) 全部压在封面底部的黑色渐变上，视觉即纯图卡。
 * uniform=true 封面按 ratio 裁切（card 网格；ratio 未给时默认 4:3）；false 保持上传原比例（瀑布流）。
 * 卡片高度 == 封面高度 → 瀑布流列底干净、估算只需 cover 比例。
 */
export default function ResourceCard({
  item,
  uniform = false,
  ratio,
}: {
  item: FeedCard;
  uniform?: boolean;
  ratio?: CardRatio | null;
}) {
  const w = item.cover?.width && item.cover.width > 0 ? item.cover.width : 3;
  const h = item.cover?.height && item.cover.height > 0 ? item.cover.height : 2;
  const cover = item.cover;
  const author = item.author.name ?? item.author.username;
  const meta = item.category?.name ?? TYPE_LABEL[item.type] ?? item.type;

  // uniform 且显式给了比例 → 按选择裁切；uniform 未给比例 → 沿用 4:3 网格默认
  // 瀑布流（非 uniform）：保留原图比例但限幅 [3/4, 4/3] ——
  // 竖图封顶 3/4 不拉长卡片；横图最扁 4/3，避免超矮卡上信息层盖满整图
  const boxAspect = uniform
    ? ((ratio && ratio !== "auto" ? CARD_RATIOS[ratio].aspect : undefined) ?? "4 / 3")
    : String(clampedAspect(w, h));

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
          <div className="absolute inset-0 grid place-items-center bg-neutral-200 text-2xl font-semibold text-neutral-400">
            {(item.title ?? "?").slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>

      {/* 左上角类型徽标（GAME 绿 / IMAGE 琥珀 / ARTICLE 天蓝，与首页 hero 徽标同风格） */}
      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-none border border-brand-600 bg-stone-900/85 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {item.type === "GAME" ? (
          <Gamepad2 size={11} className="text-emerald-300" aria-hidden />
        ) : item.type === "ARTICLE" ? (
          <Newspaper size={11} className="text-sky-300" aria-hidden />
        ) : (
          <ImageIcon size={11} className="text-amber-300" aria-hidden />
        )}
      </span>

      {/* 底部渐变 + 全覆盖信息 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgba(0,0,0,.92)_0%,rgba(0,0,0,.92)_58%,rgba(0,0,0,.55)_58%,rgba(0,0,0,.55)_78%,transparent_78.5%)] px-3 pb-2 pt-10">
        <p className="truncate text-sm font-medium leading-snug text-white drop-shadow">
          {item.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/85">
          <span className="truncate">{author}</span>
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
