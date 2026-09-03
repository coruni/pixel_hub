// 详情页共享部件 —— 纯服务端展示片段，三种模板（post/banner/twocol）复用同一套数据。
// 组件均为 server component；内部按钮（关注/点赞/下载/评论）为客户端交互组件。
import Link from "next/link";
import { CalendarDays, Download, Eye, Heart, Star } from "lucide-react";
import type { ResourceDetail } from "@/lib/queries";
import type { parseMeta } from "@/lib/meta";
import { formatCount, timeAgo } from "@/lib/format";
import Comments from "@/components/social/Comments";
import Markdown from "@/components/rte/Markdown";
import { DownloadButton, FavoriteButton, LikeButton, FollowButton } from "@/components/social/interactions";
import ReportButton from "@/components/social/ReportButton";

export type DetailCtx = {
 detail: Exclude<ResourceDetail, null>;
 meta: ReturnType<typeof parseMeta>;
 meId?: string;
 authed: boolean;
 isAuthor: boolean;
 isStaff: boolean;
};

export const typeLabel = (t: "GAME" | "IMAGE" | "ARTICLE") => (t === "GAME" ? "游戏" : t === "ARTICLE" ? "文章" : "图片");

const callbackPath = (slug: string) => `/resources/${slug}`;

export function PendingBanner({ ctx }: { ctx: DetailCtx }) {
 const { detail } = ctx;
 if (detail.status === "PUBLISHED") return null;
 return (
 <div className="mb-4 rounded-none border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
 ⏳ 该内容状态：{detail.status === "PENDING" ? "审核中（仅你可预览）" : detail.status}。
 {detail.rejectReason && <span className="ml-1">打回原因：{detail.rejectReason}</span>}
 </div>
 );
}

/** 作者名片 + 关注按钮 */
export function AuthorStrip({ ctx }: { ctx: DetailCtx }) {
 const { detail, authed, isAuthor } = ctx;
 const a = detail.author;
 return (
 <div className="flex items-center justify-between rounded-none border border-brand-200 bg-surface p-3">
 <Link href={`/u/${a.username}`} className="flex items-center gap-2.5">
 <span className="grid h-9 w-9 place-items-center rounded-none border border-brand-600 bg-brand-500 text-sm font-semibold text-white">
 {(a.name ?? a.username).slice(0, 1).toUpperCase()}
 </span>
 <span>
 <span className="block text-sm font-medium text-neutral-800">{a.name ?? a.username}</span>
 <span className="block text-xs text-neutral-400">@{a.username}</span>
 </span>
 </Link>
 {!isAuthor &&
 (authed ? (
 <FollowButton targetUserId={detail.authorId} initialFollowing={detail.viewer.followingAuthor} />
 ) : (
 <Link href="/login" className="rounded-none border border-brand-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100">
 关注
 </Link>
 ))}
 </div>
 );
}

/** 主操作：下载 / 点赞 / 收藏 / 举报（未登录给登录入口） */
export function ActionBar({ ctx }: { ctx: DetailCtx }) {
 const { detail, meId, authed, isAuthor, isStaff } = ctx;
 const path = callbackPath(detail.slug);
 return (
 <div>
 <div className="flex flex-wrap items-center gap-2">
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
 <LikeButton resourceId={detail.id} initialLiked={detail.viewer.liked} count={detail.likeCount} />
 <FavoriteButton resourceId={detail.id} initialFavorited={detail.viewer.favorited} count={detail.favoriteCount} />
 </>
 ) : (
 <>
 <Link href={`/login?callbackUrl=${encodeURIComponent(path)}`} className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-700 hover:border-brand-500">
 <Heart size={15} aria-hidden /> 点赞
 </Link>
 <Link href={`/login?callbackUrl=${encodeURIComponent(path)}`} className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-700 hover:border-brand-500">
 <Star size={15} aria-hidden /> 收藏
 </Link>
 </>
 )}
 {meId && !isAuthor && <ReportButton resourceId={detail.id} resourceTitle={detail.title} />}
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
 <span className="font-semibold text-neutral-900">{timeAgo(detail.publishedAt ?? detail.createdAt)}</span>
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
 <Link href={`/browse?cat=${detail.category.slug}`} className="text-neutral-800 hover:underline">
 {detail.category.name}
 </Link>
 </dd>
 </div>
 )}
 {detail.type === "GAME" && meta.kind === "GAME" && (
 <>
 {meta.version && <KV k="版本" v={meta.version} />}
 {meta.size && <KV k="大小" v={meta.size} />}
 {meta.platforms && meta.platforms.length > 0 && <KV k="平台" v={meta.platforms.join(" / ")} />}
 {meta.lang && <KV k="语言" v={meta.lang} />}
 </>
 )}
 {meta.kind === "IMAGE" && meta.isAiGenerated && (
 <div className="rounded-none bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
 ✨ AI 生成{meta.aiTool ? ` · ${meta.aiTool}${meta.aiModel ? ` ${meta.aiModel}` : ""}` : ""}
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

function KV({ k, v }: { k: string; v: string }) {
 return (
 <div className="flex justify-between gap-4">
 <dt className="shrink-0 text-neutral-400">{k}</dt>
 <dd className="text-right text-neutral-800">{v}</dd>
 </div>
 );
}
