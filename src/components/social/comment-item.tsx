"use client";

import Link from "next/link";
import { timeAgo } from "@/lib/format";
import Avatar from "@/components/ui/Avatar";
import UserHoverCard from "@/components/ui/UserHoverCard";
import CommentHoverCard from "./CommentHoverCard";
import type { CommentImage, CommentShape } from "./comment-types";

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
  inputCls: string;
  onReplyChange: (next: ReplyState) => void;
  onPost: (parentId: string | null, text: string) => void;
  onDelete: (commentId: string) => void;
  onNavigate: (commentId: string, fallbackRootId: string) => void;
  onViewImages: (images: CommentImage[], index: number) => void;
}) {
  const replyOpen = reply.openFor === c.id;
  const canDel = viewerId === c.authorId || !!isStaff;
  return (
    <li id={`comment-${c.id}`} data-comment-id={c.id} className="scroll-mt-24">
      <div className="flex items-center gap-2">
        <UserHoverCard user={c.author}>
          <Link
            href={`/u/${c.author.username}`}
            aria-label={`${c.author.name ?? c.author.username} 的主页`}
          >
            <Avatar
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
          <button
            type="button"
            onClick={() => onDelete(c.id)}
            className="ml-auto text-xs text-neutral-400 hover:text-red-500"
          >
            删除
          </button>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap pl-10 text-sm leading-6 text-neutral-700">
        {c.content}
      </p>
      {c.images && c.images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 pl-10">
          {c.images.map((img, i) => (
            <button
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
            </button>
          ))}
        </div>
      )}
      {canPost && (
        <button
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
        </button>
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
          <button
            type="button"
            disabled={sending || !reply.text.trim()}
            onClick={() => onPost(reply.target ? reply.target.parent : c.id, reply.text)}
            className="rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {reply.target ? `回复 @${reply.target.to}` : "回复"}
          </button>
          {reply.target && (
            <button
              type="button"
              onClick={() => onReplyChange({ ...reply, target: null })}
              className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-500 hover:border-brand-500"
            >
              取消定向
            </button>
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
  onReplyTo,
  onDelete,
  onNavigate,
}: {
  rp: CommentShape["replies"][number];
  rootId: string;
  canPost: boolean;
  canDel: boolean;
  onReplyTo: (parent: string, to: string) => void;
  onDelete: (commentId: string) => void;
  onNavigate: (commentId: string, fallbackRootId: string) => void;
}) {
  return (
    <li
      id={`comment-${rp.id}`}
      data-comment-id={rp.id}
      className="scroll-mt-24 rounded-none bg-neutral-100/70 p-3"
    >
      <div className="flex items-center gap-2">
        <UserHoverCard user={rp.author}>
          <Link
            href={`/u/${rp.author.username}`}
            aria-label={`${rp.author.name ?? rp.author.username} 的主页`}
          >
            <Avatar
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
          <button
            type="button"
            onClick={() => onDelete(rp.id)}
            className="ml-auto text-[11px] text-neutral-400 hover:text-red-500"
          >
            删除
          </button>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{rp.content}</p>
      {canPost && (
        <button
          type="button"
          onClick={() => onReplyTo(rp.id, rp.author.name ?? rp.author.username)}
          className="mt-1 text-[11px] text-neutral-400 hover:text-neutral-700"
        >
          回复
        </button>
      )}
    </li>
  );
}
