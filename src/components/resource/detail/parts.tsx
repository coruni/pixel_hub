// 详情页共享部件 —— 纯服务端展示片段，三种模板（post/banner/twocol）复用同一套数据。
// 组件均为 server component；内部按钮（关注/点赞/下载/评论）为客户端交互组件。
import Link from "next/link";
import { CalendarDays, Download, Eye, Heart, Pencil, Star } from "lucide-react";
import type { ResourceDetail } from "@/lib/queries";
import type { parseMeta } from "@/lib/meta";
import { formatCount, timeAgo } from "@/lib/format";
import Comments from "@/components/social/Comments";
import Avatar from "@/components/ui/Avatar";
import UserHoverCard from "@/components/ui/UserHoverCard";
import Markdown from "@/components/rte/Markdown";
import {
  DownloadButton,
  FavoriteButton,
  LikeButton,
  FollowButton,
} from "@/components/social/interactions";
import ReportButton from "@/components/social/ReportButton";
import { VersionDownloadButton, VersionForm } from "@/components/resource/version";
import { getUploadLimits } from "@/lib/upload-limits";

export type DetailCtx = {
  detail: Exclude<ResourceDetail, null>;
  meta: ReturnType<typeof parseMeta>;
  meId?: string;
  authed: boolean;
  isAuthor: boolean;
  isStaff: boolean;
  myCollections?: { id: string; name: string }[];
  related?: import("@/lib/queries").FeedCard[];
};

export const typeLabel = (t: "GAME" | "IMAGE" | "ARTICLE") =>
  t === "GAME" ? "游戏" : t === "ARTICLE" ? "文章" : "图片";

const callbackPath = (slug: string) => `/resources/${slug}`;

export function PendingBanner({ ctx }: { ctx: DetailCtx }) {
  const { detail } = ctx;
  if (detail.status === "PUBLISHED") return null;
  return (
    <div className="mb-4 rounded-none border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
      ⏳ 该内容状态：
      {detail.status === "PENDING" ? "审核中（仅你可预览）" : detail.status}。
      {detail.rejectReason && <span className="ml-1">打回原因：{detail.rejectReason}</span>}
    </div>
  );
}

/** 作者头像 + 昵称（hover 信息卡包裹，点击进主页）；size/handle 由各版式微调 */
export function AuthorIdentity({
  a,
  size = "md",
  handle = true,
}: {
  a: DetailCtx["detail"]["author"];
  size?: "sm" | "md";
  handle?: boolean;
}) {
  return (
    <UserHoverCard user={a}>
      <Link href={`/u/${a.username}`} className="flex items-center gap-2.5">
        <Avatar
          name={a.name}
          username={a.username}
          avatarKey={a.avatarKey}
          size={size}
          online={a.online}
        />
        <span>
          <span className="block text-sm font-medium text-neutral-800">{a.name ?? a.username}</span>
          {handle && <span className="block text-xs text-neutral-400">@{a.username}</span>}
        </span>
      </Link>
    </UserHoverCard>
  );
}

/** 关注入口：本人隐藏；已登录给 FollowButton，未登录给登录链接 */
export function FollowControl({
  ctx,
  variant = "ghost",
}: {
  ctx: DetailCtx;
  variant?: "ghost" | "primary";
}) {
  const { detail, authed, isAuthor } = ctx;
  if (isAuthor) return null;
  if (authed)
    return (
      <FollowButton
        targetUserId={detail.authorId}
        initialFollowing={detail.viewer.followingAuthor}
      />
    );
  return (
    <Link
      href="/login"
      className={
        variant === "primary"
          ? "rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-xs text-white hover:bg-brand-600"
          : "rounded-none border border-brand-200 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
      }
    >
      关注
    </Link>
  );
}

/** 作者名片 + 关注按钮 */
export function AuthorStrip({ ctx }: { ctx: DetailCtx }) {
  return (
    <div className="flex items-center justify-between rounded-none border border-brand-200 bg-surface p-3">
      <AuthorIdentity a={ctx.detail.author} />
      <FollowControl ctx={ctx} />
    </div>
  );
}

/** 主操作：下载 / 点赞 / 收藏 / 举报（未登录给登录入口） */
export function ActionBar({ ctx }: { ctx: DetailCtx }) {
  const { detail, meId, authed, isAuthor, isStaff } = ctx;
  const path = callbackPath(detail.slug);
  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-2">
        {detail.externalUrl && (
          <DownloadButton
            resourceId={detail.id}
            externalUrl={detail.externalUrl}
            loginRequired={detail.loginRequired}
            authed={authed}
            callbackPath={path}
          />
        )}
        {authed ? (
          <>
            <LikeButton
              resourceId={detail.id}
              initialLiked={detail.viewer.liked}
              count={detail.likeCount}
            />
            <FavoriteButton
              resourceId={detail.id}
              initialFavorited={detail.viewer.favorited}
              count={detail.favoriteCount}
              collections={ctx.myCollections}
              initialCollectionId={detail.viewer.favoriteCollectionId}
            />
          </>
        ) : (
          <>
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(path)}`}
              className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-700 hover:border-brand-500"
            >
              <Heart size={15} aria-hidden /> 点赞
            </Link>
            <Link
              href={`/login?callbackUrl=${encodeURIComponent(path)}`}
              className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-700 hover:border-brand-500"
            >
              <Star size={15} aria-hidden /> 收藏
            </Link>
          </>
        )}
        {meId && !isAuthor && <ReportButton resourceId={detail.id} resourceTitle={detail.title} />}
        {isAuthor && (
          <Link
            href={`/resources/${detail.slug}/edit`}
            className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-700 hover:border-brand-500"
          >
            <Pencil size={15} aria-hidden /> 编辑
          </Link>
        )}
      </div>
      {detail.loginRequired && !authed && (
        <p className="mt-1.5 text-xs text-neutral-400">该资源需登录后获取下载地址。</p>
      )}
      {!isStaff && !detail.allowComments && !isAuthor && (
        <p className="mt-1.5 text-xs text-neutral-400">作者已关闭评论。</p>
      )}
    </div>
  );
}

const statItem =
  "flex flex-col items-center gap-0.5 rounded-none border border-brand-200 bg-surface py-3";

/** 下载 / 浏览 / 发布于 三格统计 */
export function StatGrid({ ctx }: { ctx: DetailCtx }) {
  const { detail } = ctx;
  return (
    <div className="grid grid-cols-3 gap-2 text-center text-sm">
      <div className={statItem}>
        <Eye size={14} className="text-neutral-400" aria-hidden />
        <span className="font-semibold text-neutral-900">{formatCount(detail.viewCount)}</span>
        <span className="text-[11px] text-neutral-400">浏览</span>
      </div>
      <div className={statItem}>
        <Download size={14} className="text-neutral-400" aria-hidden />
        <span className="font-semibold text-neutral-900">{formatCount(detail.downloadCount)}</span>
        <span className="text-[11px] text-neutral-400">下载</span>
      </div>
      <div className={statItem}>
        <CalendarDays size={14} className="text-neutral-400" aria-hidden />
        <span className="font-semibold text-neutral-900">
          {timeAgo(detail.publishedAt ?? detail.createdAt)}
        </span>
        <span className="text-[11px] text-neutral-400">发布于</span>
      </div>
    </div>
  );
}

/** 类型/分类/版本等元信息卡 + AI/原创角标 + 标签 */
export function TypeInfoCard({ ctx }: { ctx: DetailCtx }) {
  const { detail, meta } = ctx;
  return (
    <div className="space-y-3">
      <dl className="space-y-2 rounded-none border border-brand-200 bg-surface p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-neutral-400">类型</dt>
          <dd className="text-neutral-800">{typeLabel(detail.type)}</dd>
        </div>
        {detail.category && (
          <div className="flex justify-between">
            <dt className="text-neutral-400">分类</dt>
            <dd>
              <Link
                href={`/browse?cat=${detail.category.slug}`}
                className="text-neutral-800 hover:underline"
              >
                {detail.category.name}
              </Link>
            </dd>
          </div>
        )}
        {detail.type === "GAME" && meta.kind === "GAME" && (
          <>
            {meta.version && <KV k="版本" v={meta.version} />}
            {meta.size && <KV k="大小" v={meta.size} />}
            {meta.platforms && meta.platforms.length > 0 && (
              <KV k="平台" v={meta.platforms.join(" / ")} />
            )}
            {meta.lang && <KV k="语言" v={meta.lang} />}
          </>
        )}
        {meta.kind === "IMAGE" && meta.isAiGenerated && (
          <div className="rounded-none bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            ✨ AI 生成
            {meta.aiTool ? ` · ${meta.aiTool}${meta.aiModel ? ` ${meta.aiModel}` : ""}` : ""}
          </div>
        )}
        {meta.kind === "IMAGE" && meta.original && (
          <div className="flex justify-between">
            <dt className="text-neutral-400">原创</dt>
            <dd className="text-emerald-600">✓ 作者声明原创</dd>
          </div>
        )}
        {meta.license && <KV k="授权" v={meta.license} />}
        {"sourceNote" in meta && meta.sourceNote && <KV k="来源" v={meta.sourceNote} />}
        {"note" in meta && meta.note && <KV k="说明" v={meta.note} />}
      </dl>

      {detail.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
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
    </div>
  );
}

/** 版本历史：列表 + 下载（作者可追加新版本，附件上限提示跟随后台配置） */
export async function VersionSection({ ctx }: { ctx: DetailCtx }) {
  const { detail, isAuthor } = ctx;
  const versions = detail.versions;
  if (versions.length === 0) return null;
  // 仅作者会看到「发布新版本」表单时才读配置，省一次 DB 查询
  const L = isAuthor ? await getUploadLimits() : null;
  return (
    <section className="rounded-none border border-brand-200 bg-surface p-6">
      <h2 className="text-sm font-semibold text-neutral-400">版本历史（{versions.length}）</h2>
      <ul className="mt-3 divide-y divide-neutral-100">
        {versions.map((v) => (
          <li
            key={v.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
          >
            <span className="rounded-none border border-brand-600 bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
              v{v.version}
            </span>
            <span className="text-xs text-neutral-400">{timeAgo(v.createdAt)}</span>
            {v.changelog && (
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-6 text-neutral-600">
                {v.changelog}
              </span>
            )}
            <span className={v.changelog ? "" : "min-w-0 flex-1"} />
            {v.url && (
              <VersionDownloadButton versionId={v.id} url={v.url} count={v.downloadCount} />
            )}
          </li>
        ))}
      </ul>
      {isAuthor && L && (
        <div className="mt-4 border-t border-neutral-100 pt-4">
          <VersionForm
            resourceId={detail.id}
            limits={{
              attachmentMaxMb: L.attachmentMaxMb,
              attachmentExts: L.attachmentExts,
            }}
          />
        </div>
      )}
    </section>
  );
}

/** 长描述卡（Markdown 富文本，见 DESIGN 描述=富文本） */
export function DescriptionBlock({ ctx }: { ctx: DetailCtx }) {
  return (
    <section className="rounded-none border border-brand-200 bg-surface p-6">
      <h2 className="text-sm font-semibold text-neutral-400">描述</h2>
      <div className="mt-3 md-body md-body--lg">
        <Markdown>{ctx.detail.description}</Markdown>
      </div>
    </section>
  );
}

/** 评论区 */
export function CommentBlock({ ctx }: { ctx: DetailCtx }) {
  const { detail, authed, meId, isStaff } = ctx;
  return (
    <Comments
      resourceId={detail.id}
      canPost={detail.allowComments && authed}
      viewerId={meId}
      isStaff={isStaff}
      comments={detail.comments}
    />
  );
}

/** 相关推荐：同分类热门优先。轻量形态——无外框面板，小封面卡 6 列，标题压图底，仅已发布内容 */
export function RelatedSection({ ctx }: { ctx: DetailCtx }) {
  const items = ctx.related ?? [];
  if (items.length === 0) return null;
  return (
    <section className="border-t border-neutral-100 pt-5">
      <h2 className="text-sm font-semibold text-neutral-400">相关推荐</h2>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/resources/${item.slug}`}
            className="group relative block overflow-hidden rounded-none border border-transparent bg-neutral-100 transition hover:border-brand-500"
          >
            <div className="aspect-[4/3]">
              {item.cover ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.cover.url}
                  alt={item.title}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center bg-neutral-200 text-lg font-semibold text-neutral-400">
                  {item.title.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <p className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-[linear-gradient(to_top,rgba(0,0,0,.85)_0%,rgba(0,0,0,.85)_60%,transparent_60%)] px-1.5 pb-1 pt-4 text-[11px] leading-tight text-white">
              {item.title}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-neutral-400">{k}</dt>
      <dd className="text-right text-neutral-800">{v}</dd>
    </div>
  );
}
