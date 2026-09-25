"use client";

import Link from "next/link";
import { timeAgo } from "@/lib/format";
import PresenceAvatar from "@/components/ui/PresenceAvatar";
import UserHoverCard from "@/components/ui/UserHoverCard";
import CommentHoverCard from "./CommentHoverCard";
import type { CommentImage, CommentShape } from "./comment-types";
import { Button } from "@/components/ui/Button";

/** 单个根楼层 + 楼中楼回复列表。回复框状态由 Comments 统一持有（同屏只开一个）。 */

export const commentInputCls =
  "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500";

export type ReplyState = {
  /** 展开回复框的根楼层 id */
  openFor: string | null;
  text: string;
  /** 楼中楼定向目标：{ 被回复楼层 id, 被回复人昵称 }；null 表示回复根楼层 */
  target: { parent: string; to: string } | null;
};

export default function CommentItem({
  c,
  canPost,
  viewerId,
  isStaff,
  reply,
  sending,
  deletingId,
  inputCls,
  onReplyChange,
  onPost,
  onDelete,
  onNavigate,
  onViewImages,
}: {
  c: CommentShape;
  canPost: boolean;
  viewerId?: string;
  isStaff?: boolean;
  reply: ReplyState;
  sending: boolean;
  /** 全树共用一个「正在删除」id：该条（含其回复）的删除按钮禁用并改文案，避免确认后重复点击 */
  deletingId?: string | null;
  inputCls: string;
  onReplyChange: (next: ReplyState) => void;
  onPost: (parentId: string | null, text: string) => void;
  onDelete: (commentId: string) => Promise<void>;
  onNavigate: (commentId: string, fallbackRootId: string) => void;
  onViewImages: (images: CommentImage[], index: number) => void;
}) {
  const replyOpen = reply.openFor === c.id;
  const canDel = viewerId === c.authorId || !!isStaff;
  const deleting = deletingId === c.id;
  return (
    <li id={`comment-${c.id}`} data-comment-id={c.id} className="scroll-mt-24">
      <div className="flex items-center gap-2">
        <UserHoverCard user={c.author}>
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
        <Link
          href={`/u/${c.author.username}`}
          className="text-sm font-medium text-neutral-800 hover:text-brand-600"
        >
          {c.author.name ?? c.author.username}
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
      <p className="mt-2 whitespace-pre-wrap pl-10 text-sm leading-6 text-neutral-700">
        {c.content}
      </p>
      {c.images && c.images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 pl-10">
          {c.images.map((img, i) => (
            <Button
              key={i}
              type="button"
              onClick={() => onViewImages(c.images!, i)}
              aria-label={`查看第 ${i + 1} 张图片`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                loading="lazy"
                className="max-h-40 rounded-none border border-brand-200 object-cover transition hover:border-brand-500"
              />
            </Button>
          ))}
        </div>
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
        <div className="mt-2 flex gap-2 pl-10">
          <input
            value={reply.text}
            onChange={(e) => onReplyChange({ ...reply, text: e.target.value })}
            placeholder={reply.target ? `回复 @${reply.target.to}…` : "写下回复…"}
            className={`${inputCls} flex-1`}
            aria-label={reply.target ? `回复 @${reply.target.to}` : "写下回复"}
          />
          <Button
            type="button"
            disabled={sending || !reply.text.trim()}
            onClick={() => onPost(reply.target ? reply.target.parent : c.id, reply.text)}
            variant="primary"
          >
            {reply.target ? `回复 @${reply.target.to}` : "回复"}
          </Button>
          {reply.target && (
            <Button
              type="button"
              onClick={() => onReplyChange({ ...reply, target: null })}
              variant="filter"
            >
              取消定向
            </Button>
          )}
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
              onReplyTo={(parent, to) =>
                onReplyChange({ openFor: c.id, text: reply.text, target: { parent, to } })
              }
              onDelete={onDelete}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
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
  onReplyTo,
  onDelete,
  onNavigate,
}: {
  rp: CommentShape["replies"][number];
  rootId: string;
  canPost: boolean;
  canDel: boolean;
  deleting: boolean;
  onReplyTo: (parent: string, to: string) => void;
  onDelete: (commentId: string) => Promise<void>;
  onNavigate: (commentId: string, fallbackRootId: string) => void;
}) {
  return (
    <li id={`comment-${rp.id}`} data-comment-id={rp.id} className="scroll-mt-24">
      <div className="flex items-center gap-2">
        <UserHoverCard user={rp.author}>
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
        <Link
          href={`/u/${rp.author.username}`}
          className="text-xs font-medium text-neutral-800 hover:text-brand-600"
        >
          {rp.author.name ?? rp.author.username}
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
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{rp.content}</p>
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
