import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, Download, Eye } from "lucide-react";
import { formatCount, timeAgo } from "@/lib/format";
import Gallery from "@/components/resource/Gallery";
import {
  ActionBar,
  AuthorIdentity,
  CommentBlock,
  FollowControl,
  DescriptionBlock,
  RelatedSection,
  VersionSection,
  typeLabel,
  type DetailCtx,
} from "./parts";

const chipBase = "rounded-none px-2 py-1 text-[11px] font-medium";

/** 类型化 meta + 标签 → 轻 chips（展签的「材质/尺寸」部分） */
function MetaChips({ ctx }: { ctx: DetailCtx }) {
  const { detail, meta } = ctx;
  const chips: { label: string; cls: string }[] = [];
  if (meta.kind === "IMAGE" && meta.isAiGenerated) {
    chips.push({
      label: `✨ AI 生成${meta.aiTool ? ` · ${meta.aiTool}${meta.aiModel ? ` ${meta.aiModel}` : ""}` : ""}`,
      cls: "bg-amber-50 text-amber-700",
    });
  }
  if (meta.kind === "IMAGE" && meta.original)
    chips.push({ label: "✓ 原创声明", cls: "bg-emerald-50 text-emerald-700" });
  if (meta.license)
    chips.push({
      label: `授权 · ${meta.license}`,
      cls: "bg-neutral-100 text-neutral-600",
    });
  if ("sourceNote" in meta && meta.sourceNote)
    chips.push({
      label: `来源 · ${meta.sourceNote}`,
      cls: "bg-neutral-100 text-neutral-600",
    });
  if (meta.kind === "GAME") {
    if (meta.version)
      chips.push({
        label: `v${meta.version.replace(/^v/i, "")}`,
        cls: "bg-neutral-100 text-neutral-600",
      });
    if (meta.size) chips.push({ label: meta.size, cls: "bg-neutral-100 text-neutral-600" });
    if (meta.platforms && meta.platforms.length > 0)
      chips.push({
        label: meta.platforms.join(" / "),
        cls: "bg-neutral-100 text-neutral-600",
      });
    if (meta.lang) chips.push({ label: meta.lang, cls: "bg-neutral-100 text-neutral-600" });
    if (meta.note) chips.push({ label: meta.note, cls: "bg-neutral-100 text-neutral-600" });
  }
  if (chips.length === 0 && detail.tags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c, i) => (
        <span key={i} className={`${chipBase} ${c.cls}`}>
          {c.label}
        </span>
      ))}
      {detail.tags.map((t) => (
        <Link
          key={t.tag.slug}
          href={`/tags/${t.tag.slug}`}
          className={`${chipBase} bg-neutral-100 text-neutral-600 hover:bg-neutral-200`}
        >
          #{t.tag.name}
        </Link>
      ))}
    </div>
  );
}

/** A · 展厅式 —— 图集开屏做第一视觉，信息以美术馆展签形式聚合在图下：左作品信息、右作者+操作 */
export default function DetailPost({
  ctx,
  middleSlot,
}: {
  ctx: DetailCtx;
  middleSlot?: ReactNode;
}) {
  const { detail } = ctx;
  const a = detail.author;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      {/* 展厅：直接以作品开场 */}
      <Gallery media={detail.gallery} />

      {/* 展签 */}
      <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-x-8">
        {/* 左：作品信息 */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-none border border-brand-600 bg-stone-900/85 px-2.5 py-0.5 text-[11px] font-medium text-white">
              {typeLabel(detail.type)}
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
          <h1 className="mt-2.5 text-2xl font-semibold leading-snug tracking-tight text-neutral-900 sm:text-3xl">
            {detail.title}
          </h1>
          {detail.summary && (
            <p className="mt-2 text-sm leading-6 text-neutral-500">{detail.summary}</p>
          )}

          {/* 展签数据行：年代 / 观展 / （游戏的）获取 */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-neutral-400">
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={12} aria-hidden />{" "}
              {timeAgo(detail.publishedAt ?? detail.createdAt)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Eye size={12} aria-hidden /> {formatCount(detail.viewCount)}
            </span>
            {detail.type === "GAME" && (
              <span className="inline-flex items-center gap-1">
                <Download size={12} aria-hidden /> {formatCount(detail.downloadCount)}
              </span>
            )}
          </div>
          <div className="mt-3">
            <MetaChips ctx={ctx} />
          </div>
        </div>

        {/* 右：作者 + 操作 */}
        <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
          <div className="flex items-center gap-3">
            <AuthorIdentity a={a} />
            <FollowControl ctx={ctx} variant="primary" />
          </div>
          <ActionBar ctx={ctx} />
        </div>
      </div>

      <div className="mt-8">
        <VersionSection ctx={ctx} />
      </div>
      <div className="mt-8">
        <DescriptionBlock ctx={ctx} />
      </div>
      {middleSlot && <div className="mt-6">{middleSlot}</div>}
      <div className="mt-6">
        <CommentBlock ctx={ctx} />
      </div>
      <div className="mt-8">
        <RelatedSection ctx={ctx} />
      </div>
    </div>
  );
}
