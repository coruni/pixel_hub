import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, Eye, MessageSquare, Newspaper } from "lucide-react";
import { formatCount, timeAgo } from "@/lib/format";
import Markdown from "@/components/rte/Markdown";
import {
  ActionBar,
  AuthorIdentity,
  CommentBlock,
  FollowControl,
  RelatedSection,
  type DetailCtx,
} from "./parts";
import { DownloadPanel } from "./download-panel";

/** D · 杂志阅读式 —— 文章专属：编辑部排版（左对齐大标题 + 作者 meta 行 + 阅读列正文），
 *  可带文末附件清单（DownloadPanel），无游戏向版本/信息卡面板 */
export default function DetailArticle({
  ctx,
  middleSlot,
}: {
  ctx: DetailCtx;
  middleSlot?: ReactNode;
}) {
  const { detail } = ctx;
  const a = detail.author;
  const cover = detail.gallery[0];
  const rest = detail.gallery.slice(1);
  // 阅读时长：中文按 ~300 字/分钟估算
  const minutes = Math.max(1, Math.ceil(detail.description.replace(/\s/g, "").length / 300));

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      {/* 类型徽标 + 分类 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-none border border-brand-600 bg-stone-900/85 px-2.5 py-0.5 text-[11px] font-medium text-white">
          <Newspaper size={11} className="text-sky-300" aria-hidden />
          文章
        </span>
        {detail.category && (
          <Link
            href={`/browse?cat=${detail.category.slug}`}
            className="rounded-none border border-brand-200 bg-surface px-2.5 py-0.5 text-[11px] font-medium text-neutral-500 hover:border-brand-500 hover:text-neutral-800"
          >
            {detail.category.name}
          </Link>
        )}
      </div>

      <h1 className="mt-3 text-2xl font-semibold leading-snug tracking-tight text-neutral-900 sm:text-3xl">
        {detail.title}
      </h1>
      {detail.summary && (
        <p className="mt-2.5 text-[15px] leading-7 text-neutral-500">{detail.summary}</p>
      )}

      {/* 作者 meta 行 */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 py-1">
        <AuthorIdentity a={a} size="sm" handle={false} />
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={12} aria-hidden /> {timeAgo(detail.publishedAt ?? detail.createdAt)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Eye size={12} aria-hidden /> {formatCount(detail.viewCount)}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare size={12} aria-hidden /> {formatCount(detail.commentCount)}
          </span>
          <span>约 {minutes} 分钟</span>
        </span>
        <div className="ml-auto">
          <FollowControl ctx={ctx} />
        </div>
      </div>

      {/* 封面 */}
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover.bigUrl}
          alt={detail.title}
          className="mt-6 max-h-[26rem] w-full border border-brand-200 object-cover"
        />
      )}

      {/* 正文 */}
      <article className="mt-8 md-body md-body--lg">
        <Markdown>{detail.description}</Markdown>
      </article>

      {/* 插图（封面之外的配图） */}
      {rest.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {rest.map((m) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={m.id}
              src={m.bigUrl}
              alt=""
              className="w-full border border-brand-200 object-cover"
            />
          ))}
        </div>
      )}

      {/* 文末附件清单（ARTICLE；其余类型返回 null） */}
      <DownloadPanel ctx={ctx} />

      {/* 底部操作条 */}
      <div className="mt-8 flex justify-center pt-2">
        <ActionBar ctx={ctx} />
      </div>

      {/* 标签 */}
      {detail.tags.length > 0 && (
        <div className="mt-6 flex flex-wrap justify-center gap-1.5">
          {detail.tags.map((t) => (
            <Link
              key={t.tag.slug}
              href={`/tags/${t.tag.slug}`}
              className="rounded-none bg-neutral-100 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-200"
            >
              #{t.tag.name}
            </Link>
          ))}
        </div>
      )}

      {middleSlot && <div className="mt-8">{middleSlot}</div>}
      <div className="mt-8">
        <CommentBlock ctx={ctx} />
      </div>
      <div className="mt-8">
        <RelatedSection ctx={ctx} />
      </div>
    </div>
  );
}
