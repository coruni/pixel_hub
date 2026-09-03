"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCommentAction, deleteCommentAction } from "@/lib/actions/social";
import { timeAgo } from "@/lib/format";

export type CommentShape = {
 id: string;
 authorId: string;
 content: string;
 createdAt: string | Date;
 author: { username: string; name: string | null };
 replies: {
 id: string;
 authorId: string;
 content: string;
 createdAt: string | Date;
 author: { username: string; name: string | null };
 }[];
};

function avatar(name: string) {
 return name.slice(0, 1).toUpperCase();
}

export default function Comments({
 resourceId,
 canPost,
 viewerId,
 isStaff,
 comments,
}: {
 resourceId: string;
 canPost: boolean;
 viewerId?: string;
 isStaff?: boolean;
 comments: CommentShape[];
}) {
 const router = useRouter();
 const [text, setText] = useState("");
 const [sending, setSending] = useState(false);
 const [replyTo, setReplyTo] = useState<string | null>(null);
 const [replyText, setReplyText] = useState("");
 const [error, setError] = useState<string | null>(null);

 async function post(parentId: string | null, value: string) {
 setSending(true);
 setError(null);
 const fd = new FormData();
 fd.set("resourceId", resourceId);
 if (parentId) fd.set("parentId", parentId);
 fd.set("content", value);
 const res = await addCommentAction({}, fd);
 setSending(false);
 if (res.ok) {
 setText("");
 setReplyText("");
 setReplyTo(null);
 router.refresh();
 } else {
 setError(res.error ?? "发送失败");
 }
 }

 async function remove(commentId: string) {
 const res = await deleteCommentAction(commentId);
 if (res.ok) router.refresh();
 }

 const inputCls =
 "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500";

 return (
 <section id="comments" className="mt-10 scroll-mt-24 border-t border-neutral-200 pt-8">
 <h2 className="text-lg font-semibold text-neutral-900">评论（{comments.length}）</h2>

 {error && <p className="mt-3 rounded-none bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

 {canPost ? (
 <div className="mt-4">
 <textarea
 value={text}
 onChange={(e) => setText(e.target.value)}
 rows={2}
 placeholder="友善发言，说说你的看法…"
 className={inputCls}
 />
 <div className="mt-2 flex justify-end">
 <button
 disabled={sending || !text.trim()}
 onClick={() => post(null, text)}
 className="rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-brand-600"
 >
 发表评论
 </button>
 </div>
 </div>
 ) : (
 <p className="mt-3 text-sm text-neutral-500">
 <Link href="/login" className="font-medium text-neutral-900 underline">
 登录
 </Link>{" "}
 后参与讨论
 </p>
 )}

 <ul className="mt-6 space-y-6">
 {comments.map((c) => {
 const canDel = viewerId === c.authorId || isStaff;
 return (
 <li key={c.id}>
 <div className="flex items-center gap-2">
 <span className="grid h-8 w-8 place-items-center rounded-none border border-brand-600 bg-brand-500 text-xs font-semibold text-white">
 {avatar(c.author.name ?? c.author.username)}
 </span>
 <span className="text-sm font-medium text-neutral-800">{c.author.name ?? c.author.username}</span>
 <span className="text-xs text-neutral-400">· {timeAgo(c.createdAt)}</span>
 {canDel && (
 <button onClick={() => remove(c.id)} className="ml-auto text-xs text-neutral-400 hover:text-red-500">
 删除
 </button>
 )}
 </div>
 <p className="mt-2 whitespace-pre-wrap pl-10 text-sm leading-6 text-neutral-700">{c.content}</p>
 {canPost && (
 <button
 onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
 className="mt-1.5 pl-10 text-xs text-neutral-400 hover:text-neutral-700"
 >
 {replyTo === c.id ? "收起" : "回复"}
 </button>
 )}

 {replyTo === c.id && (
 <div className="mt-2 flex gap-2 pl-10">
 <input
 value={replyText}
 onChange={(e) => setReplyText(e.target.value)}
 placeholder="写下回复…"
 className={`${inputCls} flex-1`}
 />
 <button
 disabled={sending || !replyText.trim()}
 onClick={() => post(c.id, replyText)}
 className="rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
 >
 回复
 </button>
 </div>
 )}

 {c.replies.length > 0 && (
 <ul className="ml-10 mt-3 space-y-4 border-l-2 border-neutral-100 pl-4">
 {c.replies.map((rp) => {
 const canDelR = viewerId === rp.authorId || isStaff;
 return (
 <li key={rp.id} className="rounded-none bg-neutral-100/70 p-3">
 <div className="flex items-center gap-2">
 <span className="grid h-6 w-6 place-items-center rounded-none bg-neutral-700 text-[10px] font-semibold text-white">
 {avatar(rp.author.name ?? rp.author.username)}
 </span>
 <span className="text-xs font-medium text-neutral-800">{rp.author.name ?? rp.author.username}</span>
 <span className="text-[11px] text-neutral-400">· {timeAgo(rp.createdAt)}</span>
 {canDelR && (
 <button onClick={() => remove(rp.id)} className="ml-auto text-[11px] text-neutral-400 hover:text-red-500">
 删除
 </button>
 )}
 </div>
 <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{rp.content}</p>
 </li>
 );
 })}
 </ul>
 )}
 </li>
 );
 })}
 {comments.length === 0 && <li className="text-sm text-neutral-400">还没有评论，来说两句？</li>}
 </ul>
 </section>
 );
}
