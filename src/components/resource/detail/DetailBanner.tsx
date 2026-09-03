import Link from "next/link";
import Gallery from "@/components/resource/Gallery";
import { DownloadButton } from "@/components/social/interactions";
import CollapsibleAside from "./CollapsibleAside";
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
export default function DetailBanner({ ctx }: { ctx: DetailCtx }) {
  const { detail } = ctx;
  const cover = detail.gallery[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* 顶部横幅 */}
      <div className="relative overflow-hidden rounded-none bg-neutral-900">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.bigUrl} alt="" className="h-72 w-full object-cover opacity-90 sm:h-80 md:h-[22rem]" />
        ) : (
          <div className="grid h-72 w-full place-items-center text-5xl font-bold text-white/20 sm:h-80 md:h-[22rem]">
            {detail.title.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,.88)_0%,rgba(0,0,0,.88)_55%,rgba(0,0,0,.4)_55%,rgba(0,0,0,.4)_75%,transparent_75.5%)]" />
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-none border border-brand-600 bg-stone-900/85 px-2.5 py-0.5 text-[11px] font-medium text-white">
              {typeLabel(detail.type)}
            </span>
            {detail.category && (
              <Link
                href={`/browse?cat=${detail.category.slug}`}
                className="rounded-none border border-brand-600 bg-stone-900/85 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-brand-600"
              >
                {detail.category.name}
              </Link>
            )}
            {detail.type === "GAME" && (
              <span className="rounded-none border border-brand-600 bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                游戏
              </span>
            )}
          </div>
          <h1 className="mt-2.5 text-2xl font-semibold leading-snug tracking-tight text-white sm:text-3xl">
            {detail.title}
          </h1>
          {detail.summary && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-white/80">{detail.summary}</p>}
          {detail.externalUrl && (
            <DownloadButton
              resourceId={detail.id}
              externalUrl={detail.externalUrl}
              loginRequired={detail.loginRequired}
              authed={ctx.authed}
              callbackPath={`/resources/${detail.slug}`}
            />
          )}
        </div>
      </div>

      <div className="relative">
        <CollapsibleAside
          main={
            <>
              <Gallery media={detail.gallery} />
              <ActionBar ctx={ctx} />
            </>
          }
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
        <DescriptionBlock ctx={ctx} />
        <CommentBlock ctx={ctx} />
        <RelatedSection ctx={ctx} />
      </div>
    </div>
  );
}
