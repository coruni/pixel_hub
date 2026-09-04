"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, X } from "lucide-react";
import { addCommentAction, deleteCommentAction } from "@/lib/actions/social";
import { timeAgo } from "@/lib/format";
import Avatar from "@/components/ui/Avatar";
import ImageViewer from "@/components/ui/ImageViewer";
import UserHoverCard, { type HoverCardUser } from "@/components/ui/UserHoverCard";
import CommentHoverCard from "./CommentHoverCard";

export type CommentAuthor = HoverCardUser & {
  username: string;
  name: string | null;
  avatarKey?: string | null;
};

export type CommentImage = { url: string; width: number | null; height: number | null };

export type CommentShape = {
 id: string;
 authorId: string;
 content: string;
 createdAt: string | Date;
 author: CommentAuthor;
 images?: CommentImage[];
 replies: {
 id: string;
 authorId: string;
 content: string;
 createdAt: string | Date;
 author: CommentAuthor;
 // 展平后深层回复的被回复人（二级回复为 null；content 供引用卡显示被回复原文）
 replyTo?: { id: string; name: string; content: string } | null;
 }[];
};

const IMG_MAX = 3;

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
 // 楼中楼回复的目标：{ 楼层 id, 被回复人昵称 }；null 表示回复根楼层
 const [replyTarget, setReplyTarget] = useState<{ parent: string; to: string } | null>(null);
 const [error, setError] = useState<string | null>(null);
 // 主楼附图（仅登录用户，回复不带图）
 const [files, setFiles] = useState<File[]>([]);
 const [previews, setPreviews] = useState<string[]>([]);
 const fileRef = useRef<HTMLInputElement>(null);
 // 评论图片查看器：所在楼层图片列表 + 点击的索引
 const [viewer, setViewer] = useState<{ images: CommentImage[]; index: number } | null>(null);

 // ---- 实时刷新：每 15s 拉增量新评论合并进列表（不 router.refresh，不打断输入状态） ----
 // 新类型：API 增量项（带 parentId，比 CommentShape.replies 多 images/replyTo 可选）
 type NewCommentItem = {
  id: string;
  parentId: string | null;
  authorId: string;
  content: string;
  createdAt: string | Date;
  author: CommentAuthor;
  images?: CommentImage[];
  replyTo?: { id: string; name: string; content: string } | null;
 };

 // liveComments 初值直接用 props：SSR/hydration 首轮就要渲染评论，
 // 渲染期模式只负责 props 引用变化（router.refresh 后）时重置
 const [liveComments, setLiveComments] = useState<CommentShape[]>(comments);
 const [baseComments, setBaseComments] = useState(comments);
 if (baseComments !== comments) {
  setBaseComments(comments);
  setLiveComments(comments);
 }
 // 服务端时钟基准，避免客户端时钟偏差
 const sinceRef = useRef<string>(new Date().toISOString());
 // live/base 的最新值（poll 回调用，渲染期不读写）
 const liveRef = useRef<CommentShape[] | null>(null);
 const baseCommentsRef = useRef<CommentShape[]>(comments);
 // props 变化（router.refresh）时同步 ref、重置轮询基准
 useEffect(() => {
  baseCommentsRef.current = comments;
  liveRef.current = comments; // props 全量覆盖（发帖/删帖后的 refresh）
  const times = comments.map((c) => new Date(c.createdAt).getTime()).filter((t) => !Number.isNaN(t));
  if (times.length > 0) sinceRef.current = new Date(Math.max(...times)).toISOString();
 }, [comments]);

 useEffect(() => {
  async function poll() {
  if (document.visibilityState !== "visible") return;
  try {
  const res = await fetch(
  `/api/comments?resourceId=${encodeURIComponent(resourceId)}&since=${encodeURIComponent(sinceRef.current)}`,
  { cache: "no-store" }
  );
  if (!res.ok) return;
  const data = (await res.json()) as {
  items: NewCommentItem[];
  serverTime: string;
  liveIds: string[];
  };
  sinceRef.current = data.serverTime;

  // 取最新的列表（effect 闭包只挂一次，state 会过期；ref 同步放 effect 里）
  const cur = liveRef.current ?? baseCommentsRef.current;

  // 删除兜底：本地有但服务端 liveIds 没有的评论 → 全量刷新
  const localIds = new Set(cur.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]));
  if ([...localIds].some((id) => !data.liveIds.includes(id))) {
  router.refresh();
  return;
  }

  if (data.items.length > 0) {
  const byId = new Map(cur.flatMap((c) => [[c.id, c] as const]));
  const next = cur.map((c) => ({ ...c, replies: [...c.replies] }));
  let needFull = false;
  for (const item of data.items) {
  if (byId.has(item.id)) continue; // 已存在（自己刚发的，router.refresh 已带上）
  if (!item.parentId) {
  next.push({
  id: item.id,
  authorId: item.authorId,
  content: item.content,
  createdAt: item.createdAt,
  author: item.author,
  images: item.images ?? [],
  replies: [],
  });
  } else {
  // 挂到根楼层；增量回复的父楼层可能是另一条增量回复，也可能不在本地
  let pid: string | null = item.parentId;
  let guard = 0;
  while (pid && guard++ < 20) {
  const parentItem = data.items.find((x) => x.id === pid);
  pid = parentItem?.parentId ?? null;
  }
  const root = next.find((c) => c.id === pid);
  if (root) {
  root.replies.push({
  id: item.id,
  authorId: item.authorId,
  content: item.content,
  createdAt: item.createdAt,
  author: item.author,
  replyTo: item.replyTo ?? null,
  });
  } else {
  needFull = true;
  break;
  }
  }
  }
  if (needFull) router.refresh();
  else {
  liveRef.current = next;
  setLiveComments(next);
  }
  }
  } catch {
  // 网络抖动忽略，下一轮重试
  }
  }

  const timer = setInterval(poll, 15000);
  return () => clearInterval(timer);
  // 闭包取不到最新 state，全部走 ref；interval 只挂一次
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [resourceId]);

 // merged：轮询合并后的渲染源（ref 在 poll 回调里取最新值）
 const merged = liveComments;

 // 通知等外部链接带 #comment-<id>：挂载后定位到目标评论（居中 + 闪烁）。
 // 原生锚点只滚动到贴顶且无高亮，这里统一接管；目标已删时无元素，静默不处理。
 const didLocate = useRef(false);
 useEffect(() => {
 if (didLocate.current) return;
 const m = window.location.hash.match(/^#comment-(.+)$/);
 if (!m) return;
 didLocate.current = true;
 const el = document.querySelector<HTMLElement>(`[data-comment-id="${m[1]}"]`);
 if (!el) return;
 el.scrollIntoView({ behavior: "smooth", block: "center" });
 el.classList.remove("comment-flash");
 void el.offsetWidth;
 el.classList.add("comment-flash");
 }, []);

 // 点击引用跳转：滚动到目标评论并闪烁；目标不可见/不存在时退回根楼层
 function navigateToComment(commentId: string, fallbackRootId: string) {
 const el =
 document.querySelector<HTMLElement>(`[data-comment-id="${commentId}"]`) ??
 document.querySelector<HTMLElement>(`[data-comment-id="${fallbackRootId}"]`);
 if (!el) return;
 el.scrollIntoView({ behavior: "smooth", block: "center" });
 el.classList.remove("comment-flash");
 // 重触发动画
 void el.offsetWidth;
 el.classList.add("comment-flash");
 }

 function pickImages(list: FileList | null) {
 if (!list) return;
 const next = [...files, ...Array.from(list)].slice(0, IMG_MAX);
 setFiles(next);
 setPreviews(next.map((f) => URL.createObjectURL(f)));
 }

 function removeImage(i: number) {
 const next = files.filter((_, idx) => idx !== i);
 setFiles(next);
 setPreviews(next.map((f) => URL.createObjectURL(f)));
 }

 async function post(parentId: string | null, value: string) {
 setSending(true);
 setError(null);
 const fd = new FormData();
 fd.set("resourceId", resourceId);
 if (parentId) fd.set("parentId", parentId);
 fd.set("content", value);
 if (!parentId) for (const f of files) fd.append("images", f);
 const res = await addCommentAction({}, fd);
 setSending(false);
 if (res.ok) {
 setText("");
 setReplyText("");
 setReplyTo(null);
 setReplyTarget(null);
 setFiles([]);
 setPreviews([]);
 if (fileRef.current) fileRef.current.value = "";
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

 // 总数含楼中楼回复
 const total = merged.length + merged.reduce((n, c) => n + c.replies.length, 0);

 return (
 <section id="comments" className="mt-10 scroll-mt-24 border-t border-neutral-200 pt-8">
 <h2 className="text-lg font-semibold text-neutral-900">评论（{total}）</h2>

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
 {/* 附图选择 + 预览 */}
 <div className="mt-2 flex flex-wrap items-center gap-2">
 <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900">
 <ImagePlus size={14} aria-hidden />
 附图 {files.length}/{IMG_MAX}
 <input
 ref={fileRef}
 type="file"
 accept="image/png,image/jpeg,image/webp,image/gif"
 multiple
 hidden
 onChange={(e) => pickImages(e.target.files)}
 />
 </label>
 {previews.map((src, i) => (
 <span key={src} className="relative">
 {/* eslint-disable-next-line @next/next/no-img-element */}
 <img src={src} alt="" className="h-14 w-14 rounded-none border border-brand-200 object-cover" />
 <button
 type="button"
 onClick={() => removeImage(i)}
 aria-label="移除图片"
 className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-none border border-brand-200 bg-surface text-neutral-500 hover:border-red-300 hover:text-red-500"
 >
 <X size={11} aria-hidden />
 </button>
 </span>
 ))}
 </div>
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
 {merged.map((c) => {
 const canDel = viewerId === c.authorId || isStaff;
 return (
 <li key={c.id} id={`comment-${c.id}`} data-comment-id={c.id} className="scroll-mt-24">
 <div className="flex items-center gap-2">
 <UserHoverCard user={c.author}>
 <Link href={`/u/${c.author.username}`} aria-label={`${c.author.name ?? c.author.username} 的主页`}>
 <Avatar name={c.author.name} username={c.author.username} avatarKey={c.author.avatarKey} size="sm" online={c.author.online} />
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
 <button onClick={() => remove(c.id)} className="ml-auto text-xs text-neutral-400 hover:text-red-500">
 删除
 </button>
 )}
 </div>
 <p className="mt-2 whitespace-pre-wrap pl-10 text-sm leading-6 text-neutral-700">{c.content}</p>
 {c.images && c.images.length > 0 && (
 <div className="mt-2 flex flex-wrap gap-2 pl-10">
 {c.images.map((img, i) => (
 <button
 key={i}
 type="button"
 onClick={() => setViewer({ images: c.images!, index: i })}
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
 onClick={() => {
 setReplyTo(replyTo === c.id ? null : c.id);
 setReplyTarget(null);
 }}
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
 placeholder={replyTarget ? `回复 @${replyTarget.to}…` : "写下回复…"}
 className={`${inputCls} flex-1`}
 />
 <button
 disabled={sending || !replyText.trim()}
 onClick={() => post(replyTarget ? replyTarget.parent : c.id, replyText)}
 className="rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
 >
 {replyTarget ? `回复 @${replyTarget.to}` : "回复"}
 </button>
 {replyTarget && (
 <button
 onClick={() => setReplyTarget(null)}
 className="rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-500 hover:border-brand-500"
 >
 取消定向
 </button>
 )}
 </div>
 )}

 {c.replies.length > 0 && (
 <ul className="ml-10 mt-3 space-y-4 border-l-2 border-neutral-100 pl-4">
 {c.replies.map((rp) => {
 const canDelR = viewerId === rp.authorId || isStaff;
 return (
 <li key={rp.id} id={`comment-${rp.id}`} data-comment-id={rp.id} className="scroll-mt-24 rounded-none bg-neutral-100/70 p-3">
 <div className="flex items-center gap-2">
 <UserHoverCard user={rp.author}>
 <Link href={`/u/${rp.author.username}`} aria-label={`${rp.author.name ?? rp.author.username} 的主页`}>
 <Avatar name={rp.author.name} username={rp.author.username} avatarKey={rp.author.avatarKey} size="xs" online={rp.author.online} />
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
 rootId={c.id}
 onNavigate={navigateToComment}
 />
 </span>
 )}
 <span className="text-[11px] text-neutral-400">· {timeAgo(rp.createdAt)}</span>
 {canDelR && (
 <button onClick={() => remove(rp.id)} className="ml-auto text-[11px] text-neutral-400 hover:text-red-500">
 删除
 </button>
 )}
 </div>
 <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{rp.content}</p>
 {canPost && (
 <button
 onClick={() => {
 setReplyTo(c.id);
 setReplyTarget({ parent: rp.id, to: rp.author.name ?? rp.author.username });
 }}
 className="mt-1 text-[11px] text-neutral-400 hover:text-neutral-700"
 >
 回复
 </button>
 )}
 </li>
 );
 })}
 </ul>
 )}
 </li>
 );
 })}
 {merged.length === 0 && <li className="text-sm text-neutral-400">还没有评论，来说两句？</li>}
 </ul>

 {viewer && (
 <ImageViewer
 images={viewer.images}
 index={viewer.index}
 onIndexChange={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
 onClose={() => setViewer(null)}
 />
 )}
 </section>
 );
}
