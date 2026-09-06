import Link from "next/link";
import type { ReactNode } from "react";
import Gallery from "@/components/resource/Gallery";
import { DownloadPanel } from "./download-panel";
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

/** C · 左右两栏式 —— 左列(图集/操作/描述/评论)、右栏(作者/统计/信息)，块宽各自统一，无跨列孤岛 */
export default function DetailTwocol({
  ctx,
  middleSlot,
}: {
  ctx: DetailCtx;
  middleSlot?: ReactNode;
}) {
  const { detail } = ctx;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-neutral-100 pb-4">
        <div>
          <span className="inline-flex items-center gap-1 rounded-none border border-brand-200 bg-surface px-2.5 py-0.5 text-[11px] font-medium text-neutral-500">
            {typeLabel(detail.type)}
            {detail.category && (
              <>
                {" · "}
                <Link
                  href={`/browse?cat=${detail.category.slug}`}
                  className="hover:text-neutral-800 hover:underline"
                >
                  {detail.category.name}
                </Link>
              </>
            )}
          </span>
          <h1 className="mt-2 text-2xl font-semibold leading-snug tracking-tight text-neutral-900 sm:text-[1.7rem]">
            {detail.title}
          </h1>
          {detail.summary && (
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-neutral-500">{detail.summary}</p>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 主列：图集 + 操作（与图集同宽） */}
        <div className="min-w-0 space-y-5">
          <Gallery media={detail.gallery} />
          <ActionBar ctx={ctx} />
        </div>

        {/* 信息栏 */}
        <aside className="min-w-0 space-y-4">
          <AuthorStrip ctx={ctx} />
          <StatGrid ctx={ctx} />
          <TypeInfoCard ctx={ctx} />
        </aside>
      </div>

      {/* IMAGE/ARTICLE 下载（面板对无关类型返回 null） */}
      <DownloadPanel ctx={ctx} />

      {/* 描述与评论横跨整条内容宽度 */}
      <div className="mt-8 space-y-5">
        <VersionSection ctx={ctx} />
        <DescriptionBlock ctx={ctx} />
        {middleSlot}
        <CommentBlock ctx={ctx} />
        <RelatedSection ctx={ctx} />
      </div>
    </div>
  );
}
