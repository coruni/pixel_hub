"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, X } from "lucide-react";
import { addCommentAction, deleteCommentAction } from "@/lib/actions/social";
import ImageViewer from "@/components/ui/ImageViewer";
import CommentItem, { commentInputCls, type ReplyState } from "./comment-item";
import { flashComment, useCommentPolling } from "./use-comment-polling";
import type { CommentImage, CommentShape } from "./comment-types";

export type { CommentAuthor, CommentImage, CommentShape } from "./comment-types";

const IMG_MAX = 3;

/** 资源评论区：主楼发布框（带附图）+ 评论树 + 15s 增量轮询 */
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
  const [reply, setReply] = useState<ReplyState>({ openFor: null, text: "", target: null });
  const [error, setError] = useState<string | null>(null);
  // 主楼附图（仅登录用户，回复不带图）
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // 评论图片查看器：所在楼层图片列表 + 点击的索引
  const [viewer, setViewer] = useState<{ images: CommentImage[]; index: number } | null>(null);

  const merged = useCommentPolling(resourceId, comments);

  // 通知等外部链接带 #comment-<id>：挂载后定位到目标评论（居中 + 闪烁）。
  // 原生锚点只滚动到贴顶且无高亮，这里统一接管；目标已删时无元素，静默不处理。
  const didLocate = useRef(false);
  useEffect(() => {
    if (didLocate.current) return;
    const m = window.location.hash.match(/^#comment-(.+)$/);
    if (!m) return;
    didLocate.current = true;
    const el = document.querySelector<HTMLElement>(`[data-comment-id="${m[1]}"]`);
    if (el) flashComment(el);
  }, []);

  // 点击引用跳转：滚动到目标评论并闪烁；目标不可见/不存在时退回根楼层
  function navigateToComment(commentId: string, fallbackRootId: string) {
    const el =
      document.querySelector<HTMLElement>(`[data-comment-id="${commentId}"]`) ??
      document.querySelector<HTMLElement>(`[data-comment-id="${fallbackRootId}"]`);
    if (el) flashComment(el);
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
      setReply({ openFor: null, text: "", target: null });
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
            className={commentInputCls}
            aria-label="发表评论"
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
              type="button"
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
        {merged.map((c) => (
          <CommentItem
            key={c.id}
            c={c}
            canPost={canPost}
            viewerId={viewerId}
            isStaff={isStaff}
            reply={reply}
            sending={sending}
            inputCls={commentInputCls}
            onReplyChange={setReply}
            onPost={post}
            onDelete={remove}
            onNavigate={navigateToComment}
            onViewImages={(images, index) => setViewer({ images, index })}
          />
        ))}
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
