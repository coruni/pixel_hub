"use client";

import Link from "next/link";
import { timeAgo } from "@/lib/format";
import PresenceAvatar from "@/components/ui/PresenceAvatar";
import NicknameText from "@/components/ui/NicknameText";
import UserHoverCard from "@/components/ui/UserHoverCard";
import CommentHoverCard from "./CommentHoverCard";
import {
  COMMENT_MAX,
  COMMENT_WARN_AT,
  totalPagesOf,
  type CommentImage,
  type CommentReply,
  type CommentShape,
} from "./comment-types";
import { RepliesPager } from "./CommentPager";
import { Button } from "@/components/ui/Button";
import Markdown from "@/components/rte/Markdown";
import MdEditor from "@/components/rte/MdEditorLazy";
/** 单个根楼层 + 楼中楼回复列表。回复框状态由 Comments 统一持有（同屏只开一个）。 */
const COMMENT_FEATURES = {
  "image-block": false,
  table: false,
  "block-edit": false,
} as const;

/** 评论正文排版：编辑器的 15px 是文章级字号，评论用 14px 更贴合列表节奏 */
const COMMENT_MD_CLS = "md-body text-sm leading-6 text-neutral-700";

export type ReplyState = {
  /** 展开回复框的根楼层 id */
  openFor: string | null;
  text: string;
  /** 楼中楼定向目标：{ 被回复楼层 id, 被回复人昵称 }；null 表示回复根楼层 */
  target: { parent: string; to: string } | null;
};

/** 评论附图缩略图网格：等高切片 + 序号角标，点击开查看器。
 *  与正文左对齐（pl-10 对应头像缩进），保持与文本同一条视觉基线。 */
function CommentImages({
  images,
  onView,
}: {
  images: CommentImage[];
  onView: (index: number) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2 pl-10">
      {images.map((img, i) => (
        <Button
          key={i}
          type="button"
          onClick={() => onView(i)}
          aria-label={`查看第 ${i + 1} 张附图（共 ${images.length} 张）`}
          className="group relative block"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.url}
            alt=""
            loading="lazy"
            className="h-24 w-24 rounded-none border border-brand-200 object-cover transition group-hover:border-brand-500 group-focus-visible:border-brand-500"
          />
          {images.length > 1 && (
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-0 right-0 bg-black/55 px-1 text-[11px] leading-4 text-white"
            >
              {i + 1}/{images.length}
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}

export default function CommentItem({
  c,
  canPost,
  viewerId,
  isStaff,
  nicknameEnabled,
  reply,
  sending,
  deletingId,
  repliesPending,
  onReplyChange,
  onPost,
  onReplyComposerKeyDown,
  onDelete,
  onNavigate,
  onRepliesPage,
  onViewImages,
}: {
  c: CommentShape;
  canPost: boolean;
  viewerId?: string;
  isStaff?: boolean;
  /** 昵称特效色功能开关（服务端读配置后下发）；关闭时评论昵称保持默认色 */
  nicknameEnabled: boolean;
  reply: ReplyState;
  sending: boolean;
  /** 全树共用一个「正在删除」id：该条（含其回复）的删除按钮禁用并改文案，避免确认后重复点击 */
  deletingId?: string | null;
  /** 该根楼层正在切换回复页 */
  repliesPending: boolean;
  onReplyChange: (next: ReplyState) => void;
  onPost: (parentId: string | null, text: string) => void;
  onReplyComposerKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onDelete: (commentId: string) => Promise<void>;
  onNavigate: (commentId: string, fallbackRootId: string) => void;
  onRepliesPage: (rootId: string, page: number) => void;
  onViewImages: (images: CommentImage[], index: number) => void;
}) {
  const replyOpen = reply.openFor === c.id;
  const canDel = viewerId === c.authorId || !!isStaff;
  const deleting = deletingId === c.id;
  return (
    <li id={`comment-${c.id}`} data-comment-id={c.id} className="scroll-mt-24">
      <div className="flex items-center gap-2">
        <UserHoverCard user={c.author} nicknameEnabled={nicknameEnabled}>
          <Link
            href={`/u/${c.author.username}`}
            aria-label={`${c.author.name ?? c.author.username} 的主页`}
          >
            <PresenceAvatar
              userId={c.authorId}
              name={c.author.name}
              username={c.author.username}
              avatarKey={c.author.avatarKey}
              size="sm"
              online={c.author.online}
            />
          </Link>
        </UserHoverCard>
        <Link href={`/u/${c.author.username}`}>
          {/* hover 色写在昵称自身：昵称色是子元素自己的 color，父链路的 hover:text-* 盖不住它 */}
          <NicknameText
            name={c.author.name}
            username={c.author.username}
            color={c.author.nameColor}
            enabled={nicknameEnabled}
            className="text-sm font-medium hover:text-brand-600"
            fallbackClassName="text-neutral-800"
          />
        </Link>
        <span className="text-xs text-neutral-400">· {timeAgo(c.createdAt)}</span>
        {canDel && (
          <Button
            type="button"
            disabled={deleting}
            onClick={() => onDelete(c.id)}
            className="ml-auto text-xs text-neutral-400 hover:text-red-500 disabled:opacity-50"
          >
            {deleting ? "删除中…" : "删除"}
          </Button>
        )}
      </div>
      <div className="md-body-wrap mt-2 pl-10 text-neutral-700">
        <div className={COMMENT_MD_CLS}>
          <Markdown zoomable>{c.content}</Markdown>
        </div>
      </div>
      {c.images && c.images.length > 0 && (
        <CommentImages images={c.images} onView={(i) => onViewImages(c.images!, i)} />
      )}
      {canPost && (
        <Button
          type="button"
          onClick={() =>
            onReplyChange(
              replyOpen
                ? { openFor: null, text: "", target: null }
                : { openFor: c.id, text: "", target: null },
            )
          }
          className="mt-1.5 pl-10 text-xs text-neutral-400 hover:text-neutral-700"
        >
          {replyOpen ? "收起" : "回复"}
        </Button>
      )}

      {replyOpen && (
        <div className="mt-2 pl-10">
          <div onKeyDown={onReplyComposerKeyDown}>
            <MdEditor
              key={`${c.id}:${reply.target?.parent ?? "root"}`}
              defaultValue=""
              onChange={(text) => onReplyChange({ ...reply, text })}
              minHeight="5rem"
              ariaLabel={reply.target ? `回复 @${reply.target.to}` : "写下回复"}
              placeholder={reply.target ? `回复 @${reply.target.to}… 支持 Markdown` : "写下回复… 支持 Markdown"}
              features={COMMENT_FEATURES}
              toolbar={false}
              compact
            />
            {reply.text.length > COMMENT_MAX - COMMENT_WARN_AT && (
              <p
                className={`mt-1 text-right text-xs ${
                  reply.text.length > COMMENT_MAX ? "text-red-500" : "text-amber-600"
                }`}
              >
                {reply.text.length}/{COMMENT_MAX}
              </p>
            )}
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                disabled={sending || !reply.text.trim() || reply.text.length > COMMENT_MAX}
                onClick={() => onPost(reply.target ? reply.target.parent : c.id, reply.text)}
                variant="primary"
              >
                {reply.target ? `回复 @${reply.target.to}` : "回复"}
              </Button>
              {reply.target && (
                <Button
                  type="button"
                  onClick={() => onReplyChange({ ...reply, text: "", target: null })}
                  variant="filter"
                >
                  取消定向
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {c.replies.length > 0 && (
        <ul className="ml-10 mt-3 space-y-4 border-l-2 border-neutral-100 pl-4">
          {c.replies.map((rp) => (
            <ReplyItem
              key={rp.id}
              rootId={c.id}
              rp={rp}
              canPost={canPost}
              canDel={viewerId === rp.authorId || !!isStaff}
              deleting={deletingId === rp.id}
              nicknameEnabled={nicknameEnabled}
              onReplyTo={(parent, to) =>
                onReplyChange({ openFor: c.id, text: "", target: { parent, to } })
              }
              onDelete={onDelete}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}

      {/* 回复超过一页才给分页器：单页已经全展开了，摆个「1/1」只是噪音 */}
      {totalPagesOf(c.repliesPaging) > 1 && (
        <RepliesPager
          paging={c.repliesPaging}
          pending={repliesPending}
          onChange={(page) => onRepliesPage(c.id, page)}
        />
      )}
    </li>
  );
}

function ReplyItem({
  rp,
  rootId,
  canPost,
  canDel,
  deleting,
  nicknameEnabled,
  onReplyTo,
  onDelete,
  onNavigate,
}: {
  rp: CommentReply;
  rootId: string;
  canPost: boolean;
  canDel: boolean;
  deleting: boolean;
  /** 昵称特效色功能开关，由 CommentItem 透传 */
  nicknameEnabled: boolean;
  onReplyTo: (parent: string, to: string) => void;
  onDelete: (commentId: string) => Promise<void>;
  onNavigate: (commentId: string, fallbackRootId: string) => void;
}) {
  return (
    <li id={`comment-${rp.id}`} data-comment-id={rp.id} className="scroll-mt-24">
      <div className="flex items-center gap-2">
        <UserHoverCard user={rp.author} nicknameEnabled={nicknameEnabled}>
          <Link
            href={`/u/${rp.author.username}`}
            aria-label={`${rp.author.name ?? rp.author.username} 的主页`}
          >
            <PresenceAvatar
              userId={rp.authorId}
              name={rp.author.name}
              username={rp.author.username}
              avatarKey={rp.author.avatarKey}
              size="xs"
              online={rp.author.online}
            />
          </Link>
        </UserHoverCard>
        <Link href={`/u/${rp.author.username}`}>
          <NicknameText
            name={rp.author.name}
            username={rp.author.username}
            color={rp.author.nameColor}
            enabled={nicknameEnabled}
            className="text-xs font-medium hover:text-brand-600"
            fallbackClassName="text-neutral-800"
          />
        </Link>
        {rp.replyTo && (
          <span className="text-[11px] text-neutral-400">
            回复{" "}
            <CommentHoverCard
              data={{ id: rp.replyTo.id, content: rp.replyTo.content, author: rp.replyTo.name }}
              rootId={rootId}
              onNavigate={onNavigate}
            />
          </span>
        )}
        <span className="text-[11px] text-neutral-400">· {timeAgo(rp.createdAt)}</span>
        {canDel && (
          <Button
            type="button"
            disabled={deleting}
            onClick={() => onDelete(rp.id)}
            className="ml-auto text-[11px] text-neutral-400 hover:text-red-500 disabled:opacity-50"
          >
            {deleting ? "删除中…" : "删除"}
          </Button>
        )}
      </div>
      <div className="mt-1.5 pl-10 text-neutral-700">
        <div className={COMMENT_MD_CLS}>
          <Markdown zoomable>{rp.content}</Markdown>
        </div>
      </div>
      {canPost && (
        <Button
          type="button"
          onClick={() => onReplyTo(rp.id, rp.author.name ?? rp.author.username)}
          className="mt-1 text-[11px] text-neutral-400 hover:text-neutral-700"
        >
          回复
        </Button>
      )}
    </li>
  );
}
