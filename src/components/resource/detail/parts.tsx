// 详情页共享部件 —— 纯服务端展示片段，三种模板（post/banner/twocol）复用同一套数据。
// 组件均为 server component；内部按钮（关注/点赞/收藏/举报）为客户端交互组件。
import Link from "next/link";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Bot, CalendarDays, Download, Eye, Heart, Pencil, Pin, Sparkles, Star } from "lucide-react";
import type { ResourceDetail } from "@/lib/queries";
import type { parseMeta } from "@/lib/meta";
import { formatCount, timeAgo } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/display";
import Comments from "@/components/social/Comments";
import PresenceAvatar from "@/components/ui/PresenceAvatar";
import UserHoverCard from "@/components/ui/UserHoverCard";
import NicknameText from "@/components/ui/NicknameText";
import { TypeIcon } from "@/components/resource/type-icon";
import TagChip from "@/components/resource/TagChip";
import Markdown from "@/components/rte/Markdown";
import MarkdownImages from "@/components/rte/MarkdownImages";
import { FavoriteButton, LikeButton, FollowButton } from "@/components/social/interactions";
import ReportButton from "@/components/social/ReportButton";
import TipButton from "@/components/social/TipButton";
import { tipFormOf } from "@/lib/points-config";
import { getUploadLimits } from "@/lib/upload-limits";
import { getIncentive } from "@/lib/incentive";

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

/** 类型展示名：统一取 TYPE_LABEL，新增类型无需再改这里 */
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;

/**
 * 详情页标题区的运营标记：置顶 / 精华（仅管理员可设，见 lib/actions/moderation.ts）。
 *
 * 四处模板（banner 的两个分支 / post / twocol / article）共用这一个组件 —— 各写一遍的话
 * 配色与图标迟早只改到其中三处。设计上与本页原有的「类型 / 分类」徽标同高（h-[22px]），
 * 直接塞进它们所在的那条 flex 行里即可，不额外占一行。
 *
 * `tone` 跟随标题所在底色：banner 是深色大图（dark → 亮阶），其余是浅底（light → 语义阶）。
 * 与资源卡右上角的角标同一套口径（见 components/resource/ResourceCard.tsx）。
 */
export function DetailMarks({
  pinned,
  featured,
  tone = "light",
}: {
  pinned: boolean;
  featured: boolean;
  tone?: "light" | "dark";
}) {
  if (!pinned && !featured) return null;
  const base =
    "inline-flex h-[22px] items-center gap-1 rounded-none border px-2 text-[11px] font-medium";
  const pinCls =
    tone === "dark"
      ? "border-brand-600 bg-stone-900/85 text-white"
      : "border-brand-300 bg-brand-100 text-brand-800";
  const featCls =
    tone === "dark"
      ? "border-amber-500 bg-stone-900/85 text-amber-300"
      : "border-amber-300 bg-amber-100 text-amber-800";
  return (
    <>
      {pinned && (
        <span className={`${base} ${pinCls}`} title="置顶">
          <Pin size={12} aria-hidden />
          置顶
        </span>
      )}
      {featured && (
        <span className={`${base} ${featCls}`} title="精华">
          <Sparkles size={12} aria-hidden />
          精华
        </span>
      )}
    </>
  );
}

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
export async function AuthorIdentity({
  a,
  size = "md",
  handle = true,
}: {
  a: DetailCtx["detail"]["author"];
  size?: "sm" | "md";
  handle?: boolean;
}) {
  // 昵称色开关只读这一次：本组件要自己渲染昵称，还要转交给 UserHoverCard 的弹层
  // （弹层是客户端组件，读不到服务端配置）。getIncentive 走 cache()，不会多查库。
  const nicknameEnabled = (await getIncentive()).decoration.nicknameEnabled;
  return (
    <UserHoverCard user={a} nicknameEnabled={nicknameEnabled}>
      <Link href={`/u/${a.username}`} className="flex items-center gap-2.5">
        <PresenceAvatar
          userId={a.id}
          name={a.name}
          username={a.username}
          avatarKey={a.avatarKey}
          size={size}
          online={a.online}
        />
        <span>
          <NicknameText
            name={a.name}
            username={a.username}
            color={a.nameColor}
            enabled={nicknameEnabled}
            className="block text-sm font-medium"
            fallbackClassName="text-neutral-800"
          />
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
          : "rounded-none border border-brand-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
      }
    >
      关注
    </Link>
  );
}

/** 作者名片 + 关注 */
export function AuthorStrip({ ctx }: { ctx: DetailCtx }) {
  return (
    <div className="flex items-center justify-between rounded-none border border-brand-300 bg-surface p-3">
      <AuthorIdentity a={ctx.detail.author} />
      <FollowControl ctx={ctx} />
    </div>
  );
}

/**
 * 主操作：点赞 / 收藏 / 打赏 / 举报 / 编辑（未登录给登录入口）；下载统一走附件面板。
 *
 * 一行「图标 + 文字」的动作条，收在行右端——读者的点赞/收藏是读完之后的顺手动作，
 * 固定在内容右端才符合「翻到哪、点到哪」的操作习惯；做成带框带底的按钮则会在图集下方
 * 堆出一整块视觉重量，把注意力从作品本身抢走。状态靠颜色 + 文案（点赞 ↔ 已赞）双通道表达，
 * 不依赖颜色单通道。动作项样式见 Button 的 `action` 变体。
 *
 * 【打赏只在详情页】钱记在这件作品名下（`TipRecord.resourceId = id`），个人主页的作者维度入口已撤掉
 * ——收款方本来就是同一个人，两个入口只会让人犹豫按哪个。三个不出入口的条件：
 *   ① 未登录（没有余额可付，给一个点了必然报错的面板不如不给；点赞/收藏零成本，才给登录链接）
 *   ② 作者本人（服务端也拦「不能打赏自己」，这里不渲染废按钮）
 *   ③ 激励体系或打赏开关关闭（`tipFormOf` 返回 undefined）
 */
export async function ActionBar({ ctx }: { ctx: DetailCtx }) {
  const { detail, meId, authed, isAuthor, isStaff } = ctx;
  const path = callbackPath(detail.slug);
  const loginHref = `/login?callbackUrl=${encodeURIComponent(path)}`;
  // 打赏面板参数与后台配置同源；getIncentive 走 cache()，与页面其它取配置处共用一次查询
  const tipForm = tipFormOf(await getIncentive());
  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-x-4 gap-y-0.5">
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
            {!isAuthor && tipForm && <TipButton resourceId={detail.id} {...tipForm} />}
          </>
        ) : (
          <>
            <ButtonLink href={loginHref} variant="action">
              <Heart size={15} aria-hidden /> 点赞
            </ButtonLink>
            <ButtonLink href={loginHref} variant="action">
              <Star size={15} aria-hidden /> 收藏
            </ButtonLink>
          </>
        )}
        {meId && !isAuthor && <ReportButton resourceId={detail.id} resourceTitle={detail.title} />}
        {isAuthor && (
          <ButtonLink href={`/resources/${detail.slug}/edit`} variant="action">
            <Pencil size={15} aria-hidden /> 编辑
          </ButtonLink>
        )}
      </div>
      {!isStaff && !detail.allowComments && !isAuthor && (
        <p className="mt-1 text-right text-xs text-neutral-400">作者已关闭评论。</p>
      )}
    </div>
  );
}

const statItem =
  "flex flex-col items-center gap-0.5 rounded-none border border-brand-300 bg-surface py-3";

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
      <dl className="space-y-2 rounded-none border border-brand-300 bg-surface p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-neutral-400">类型</dt>
          <dd>
            {/* 图标展示（与资源卡角标同一张类型表）：形状本身可辨，类型名走 sr-only + title，
                不让「类型」只靠一个图形表达；配色取 brand-600——它是 globals.css 里
                亮暗自适应的语义阶，emerald/sky 那几档没有暗色覆盖，压深底会糊掉 */}
            <span
              className="inline-flex items-center text-brand-600"
              title={typeLabel(detail.type)}
            >
              <TypeIcon type={detail.type} size={16} />
              <span className="sr-only">{typeLabel(detail.type)}</span>
            </span>
          </dd>
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
            {meta.size && <KV k="大小" v={meta.size} />}
            {meta.platforms && meta.platforms.length > 0 && (
              <KV k="平台" v={meta.platforms.join(" / ")} />
            )}
            {meta.lang && <KV k="语言" v={meta.lang} />}
          </>
        )}
        {/* 「播放方式」只对视频有意义：音频恒为站内直链播放器（mode 在 parseMeta 里被钉成 direct） */}
        {meta.kind === "VIDEO" && <KV k="播放方式" v={meta.mode === "embed" ? "嵌入页" : "直链"} />}
        {meta.kind === "IMAGE" && meta.isAiGenerated && (
          <div className="flex items-center gap-1.5 rounded-none bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            <Bot size={12} aria-hidden />
            <span className="font-medium">AI 生成</span>
            {meta.aiTool ? ` · ${meta.aiTool}${meta.aiModel ? ` ${meta.aiModel}` : ""}` : ""}
          </div>
        )}
        {meta.kind === "IMAGE" && meta.original && (
          <div className="flex justify-between">
            <dt className="text-neutral-400">原创</dt>
            <dd className="text-emerald-600">✓ 作者声明原创</dd>
          </div>
        )}
        {"license" in meta && meta.license && <KV k="授权" v={meta.license} />}
        {"sourceNote" in meta && meta.sourceNote && <KV k="来源" v={meta.sourceNote} />}
        {"note" in meta && meta.note && <KV k="说明" v={meta.note} />}
      </dl>

      {detail.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {detail.tags.map((t) => (
            <TagChip key={t.tag.slug} slug={t.tag.slug} name={t.tag.name} />
          ))}
        </div>
      )}
    </div>
  );
}


/** 长描述正文（Markdown 富文本，见 DESIGN 描述=富文本）。
 *  排版即文章正文本身：不套卡片（无边框/底色/内距），也不带小标题 —— 与 DetailArticle
 *  的正文逐字一致，四个模板共用这一处实现。
 *  正文里的图片统一走「点击看大图」：MarkdownImages 承载排版 <section>（DOM 与改造前一致）
 *  并在捕获阶段接管点击，交给全站 ImageViewer 打开，可在同正文多张图之间前后切换。
 *  gfm：资源正文是唯一开启 GFM 扩展的渲染点 —— 编辑器（Milkdown Crepe）默认带表格特性，
 *  作者能插表格，渲染端不认就会把整段表格语法当普通段落显示成一行 `| a | b |`。 */
export function DescriptionBlock({ ctx }: { ctx: DetailCtx }) {
  return (
    <MarkdownImages className="md-body md-body--lg">
      <Markdown zoomable gfm>{ctx.detail.description}</Markdown>
    </MarkdownImages>
  );
}

/** 评论区（附图上限读后台上传限制配置；昵称色开关读激励配置） */
export async function CommentBlock({ ctx }: { ctx: DetailCtx }) {
  const { detail, authed, meId, isStaff } = ctx;
  const [L, incentive] = await Promise.all([getUploadLimits(), getIncentive()]);
  return (
    <Comments
      resourceId={detail.id}
      canPost={detail.allowComments && authed}
      viewerId={meId}
      isStaff={isStaff}
      comments={detail.comments}
      commentsPaging={detail.commentsPaging}
      imageMax={L.commentImageMaxCount}
      nicknameEnabled={incentive.decoration.nicknameEnabled}
    />
  );
}

/** 相关推荐：同分类热门优先。轻量形态——无外框面板，小封面卡 6 列，标题压图底，仅已发布内容 */
export function RelatedSection({ ctx }: { ctx: DetailCtx }) {
  const items = ctx.related ?? [];
  if (items.length === 0) return null;
  return (
    <section className="border-t-2 border-dashed border-brand-300 pt-5">
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
