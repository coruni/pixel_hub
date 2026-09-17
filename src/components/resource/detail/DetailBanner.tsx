import Link from "next/link";
import type { ReactNode } from "react";
import { typeBadge } from "@/lib/type-icons";
import Gallery from "@/components/resource/Gallery";
import CollapsibleAside from "./CollapsibleAside";
import { DownloadPanel } from "./download-panel";
import { AvPlayerBlock } from "./av-player";
import {
  ActionBar,
  AuthorStrip,
  CommentBlock,
  DescriptionBlock,
  RelatedSection,
  StatGrid,
  TypeInfoCard,
  VersionSection,
  typeLabel,
  type DetailCtx,
} from "./parts";

/** B · 顶栏横幅式 —— 顶部封面 + 关键信息横幅，下方接图集与描述，适合游戏 */
export default function DetailBanner({
  ctx,
  middleSlot,
}: {
  ctx: DetailCtx;
  middleSlot?: ReactNode;
}) {
  const { detail } = ctx;
  const cover = detail.gallery[0];
  // 类型用图标徽标表示（不重复文字），分类仍用可点击的文字徽标
  const { Icon: TypeIcon, cls: typeCls } = typeBadge(detail.type);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-6 sm:px-6">
      {/* 顶部横幅 */}
      <div className="relative overflow-hidden rounded-none bg-neutral-900">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover.bigUrl}
            alt=""
            className="h-72 w-full object-cover opacity-90 sm:h-80 md:h-[22rem]"
          />
        ) : (
          <div className="grid h-72 w-full place-items-center text-5xl font-bold text-white/20 sm:h-80 md:h-[22rem]">
            {detail.title.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,.6)_0%,rgba(0,0,0,.92)_55%, transparent_100%)]" />
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            {/* 类型：图标徽标（悬停/读屏提供类型名），与分类文字徽标同高 */}
            <span
              title={typeLabel(detail.type)}
              className="grid h-[22px] w-[22px] place-items-center rounded-none border border-brand-600 bg-stone-900/85"
            >
              <TypeIcon size={13} className={typeCls} aria-hidden />
              <span className="sr-only">{typeLabel(detail.type)}</span>
            </span>
            {detail.category && (
              <Link
                href={`/browse?cat=${detail.category.slug}`}
                className="inline-flex h-[22px] items-center rounded-none border border-brand-600 bg-stone-900/85 px-2.5 text-[11px] font-medium text-white hover:bg-brand-600"
              >
                {detail.category.name}
              </Link>
            )}
          </div>
          <h1 className="mt-2.5 text-2xl font-semibold leading-snug tracking-tight text-white sm:text-3xl">
            {detail.title}
          </h1>
          {detail.summary && (
            <p className="mt-1.5 line-clamp-2 max-w-2xl text-sm leading-6 text-white/80">{detail.summary}</p>
          )}
        </div>
      </div>

      {/* 音视频播放（MUSIC/VIDEO；其余类型返回 null） */}
      <AvPlayerBlock ctx={ctx} />

      <div className="relative">
        <CollapsibleAside
          main={<Gallery media={detail.gallery} />}
          aside={
            <>
              <AuthorStrip ctx={ctx} />
              <StatGrid ctx={ctx} />
              <TypeInfoCard ctx={ctx} />
            </>
          }
        />
      </div>

      {/* 描述与评论横跨整条内容宽度（不局限于窄主列） */}
      <div className="mt-6 space-y-5">
        <VersionSection ctx={ctx} />
        {/* 统一下载面板：贴近描述上方（IMAGE/ARTICLE/GAME externalUrl；无关类型返回 null） */}
        <DownloadPanel ctx={ctx} />
        {/* 操作条贴在描述上边、且在两栏网格之外：放进图集左列时 justify-end
            只能顶到 340px 侧栏的左边缘，够不到版心右侧。 */}
        <ActionBar ctx={ctx} />
        <DescriptionBlock ctx={ctx} />
        {middleSlot}
        <CommentBlock ctx={ctx} />
        <RelatedSection ctx={ctx} />
      </div>
    </div>
  );
}
