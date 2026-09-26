"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, X } from "lucide-react";
import { CrepeFeature } from "@milkdown/crepe";
import { addCommentAction, deleteCommentAction } from "@/lib/actions/social";
import ImageViewer from "@/components/ui/ImageViewer";
import MdEditor from "@/components/rte/MdEditor";
import { confirmDialog, toast } from "@/components/ui/feedback";
import CommentItem, { commentInputCls, type ReplyState } from "./comment-item";
import { flashComment, useCommentPolling } from "./use-comment-polling";
import type { CommentImage, CommentShape } from "./comment-types";
import { Button } from "@/components/ui/Button";

export type { CommentAuthor, CommentImage, CommentShape } from "./comment-types";

/** 评论正文长度上限，与 social.ts 的 commentSchema.max(2000) 同口径（按 Markdown 源码字符数） */
const COMMENT_MAX = 2000;
/** 剩余多少字开始提示 */
const COMMENT_WARN_AT = 200;

/** 评论编辑器：关掉图片块（不提供上传入口）、表格与工具栏，只保留基础 Markdown 语法。
 *  ImageBlock 关闭后斜杠菜单的 Image 项自动消失；手打 ![alt](url) 仍可生成行内图，
 *  该风险在渲染层用图片域名白名单兜底（见 comment-item / Markdown）。 */
const COMMENT_FEATURES: Partial<Record<CrepeFeature, boolean>> = {
  [CrepeFeature.ImageBlock]: false,
  [CrepeFeature.Table]: false,
};

/** 资源评论区：主楼发布框（带附图）+ 评论树 + 15s 增量轮询 */
export default function Comments({
  resourceId,
  canPost,
  viewerId,
  isStaff,
  comments,
  imageMax,
}: {
  resourceId: string;
  canPost: boolean;
  viewerId?: string;
  isStaff?: boolean;
  comments: CommentShape[];
  /** 附图张数上限：后台 /admin/uploads「评论附图张数」，0 = 禁止附图 */
  imageMax: number;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  /** 正在删除的评论 id（非空时该条删除按钮禁用，防重复提交） */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reply, setReply] = useState<ReplyState>({ openFor: null, text: "", target: null });
  const [error, setError] = useState<string | null>(null);
  // 主楼附图（仅登录用户，回复不带图）
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  /** previews 的镜像：卸载清理需要读到最新值，但清理 effect 不能依赖它（否则每次变更都跑一遍卸载） */
  const previewsRef = useRef<string[]>([]);
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);
  // 评论图片查看器：所在楼层图片列表 + 点击的索引
  const [viewer, setViewer] = useState<{ images: CommentImage[]; index: number } | null>(null);
  /** 编辑器实例键：发表成功后自增以重置编辑器内容（MdEditor 的 defaultValue 仅挂载时消费） */
  const [editorKey, setEditorKey] = useState(0);

  const merged = useCommentPolling(resourceId, comments);

  // 外部链接带 #comment-<id>：挂载后定位并高亮（居中+闪烁）；目标已删则静默跳过。
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
    const next = [...files, ...Array.from(list)].slice(0, imageMax);
    setFiles(next);
    syncPreviews(next);
  }

  /** 预览 URL 与 files 一一对应地重建：先释放旧的再建新的，避免反复增删持续泄漏 blob */
  function syncPreviews(next: File[]) {
    setPreviews((prev) => {
      for (const url of prev) URL.revokeObjectURL(url);
      return next.map((f) => URL.createObjectURL(f));
    });
  }

  function removeImage(i: number) {
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    syncPreviews(next);
  }

  /** 发表成功后清空附图，并释放预览 blob */
  const clearImages = useCallback(() => {
    setFiles([]);
    setPreviews((prev) => {
      for (const url of prev) URL.revokeObjectURL(url);
      return [];
    });
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  // 卸载时释放剩余预览 blob（组件被路由切换销毁的情况）
  useEffect(() => () => {
    for (const url of previewsRef.current) URL.revokeObjectURL(url);
  }, []);

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
      // 楼中楼回复框是受控 input，由 text 驱动；主楼编辑器非受控，靠换 key 重建来清空
      if (!parentId) {
        clearImages();
        setEditorKey((k) => k + 1);
      }
      router.refresh();
    } else {
      setError(res.error ?? "发送失败");
    }
  }

  // Ctrl/Cmd + Enter 发表主楼评论（编辑器内亦可直接触发）
  function onComposerKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!sending && text.trim() && text.length <= COMMENT_MAX) void post(null, text);
    }
  }

  async function remove(commentId: string) {
    // 删的是根楼层时提醒回复的去向：回复不会一起消失，会上移成独立评论（见 queries 的 rootIdOf 上溯）
    const replies = merged.find((c) => c.id === commentId)?.replies.length ?? 0;
    const ok = await confirmDialog({
      title: "删除评论",
      message: replies
        ? `删除后无法恢复。这条评论下的 ${replies} 条回复会保留，并上移为独立评论。`
        : "删除后无法恢复，确认删除这条评论？",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    setDeletingId(commentId);
    try {
      const res = await deleteCommentAction(commentId);
      if (res.ok) {
        toast("评论已删除", "success");
      } else {
        toast(res.error ?? "删除失败，请稍后再试", "error");
      }
    } catch {
      toast("网络异常，未能确认删除结果，请刷新页面查看", "error");
    } finally {
      setDeletingId(null);
      // 成功或结果未知都刷新：服务端可能已经删掉了，让列表回到真实状态
      router.refresh();
    }
  }

  // 总数含楼中楼回复
  const total = merged.length + merged.reduce((n, c) => n + c.replies.length, 0);

  return (
    <section id="comments" className="mt-10 scroll-mt-24 border-t border-neutral-200 pt-8">
      <h2 className="text-lg font-semibold text-neutral-900">评论（{total}）</h2>

      {error && (
        <p className="mt-3 rounded-none bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {canPost ? (
        <div className="mt-4" onKeyDown={onComposerKeyDown}>
          <MdEditor
            key={editorKey}
            defaultValue=""
            onChange={setText}
            minHeight="6rem"
            ariaLabel="发表评论"
            placeholder="友善发言，说说你的看法… 支持 Markdown 基础语法，输入 / 唤出块类型"
            features={COMMENT_FEATURES}
            toolbar={false}
            compact
          />
          {text.length > COMMENT_MAX - COMMENT_WARN_AT && (
            <p
              className={`mt-1 text-right text-xs ${
                text.length > COMMENT_MAX ? "text-red-500" : "text-amber-600"
              }`}
            >
              {text.length}/{COMMENT_MAX}
            </p>
          )}
          {/* 附图选择 + 预览（imageMax = 0 时隐藏入口） */}
          {imageMax > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900">
              <ImagePlus size={14} aria-hidden />
              附图 {files.length}/{imageMax}
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
                <img
                  src={src}
                  alt={`待上传的附图 ${i + 1}`}
                  className="h-14 w-14 rounded-none border border-brand-200 object-cover"
                />
                <Button
                  type="button"
                  onClick={() => removeImage(i)}
                  aria-label={`移除附图 ${i + 1}`}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-none border border-brand-200 bg-surface text-neutral-500 hover:border-red-300 hover:text-red-500"
                >
                  <X size={11} aria-hidden />
                </Button>
              </span>
            ))}
          </div>
          )}
          <div className="mt-2 flex items-center justify-end gap-3">
            <span className="text-xs text-neutral-400">
              支持 Markdown 基础语法
            </span>
            <Button
              type="button"
              disabled={sending || !text.trim() || text.length > COMMENT_MAX}
              onClick={() => post(null, text)}
              variant="primary" size="md"
            >
              {sending ? "发送中…" : "发表评论"}
            </Button>
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
            deletingId={deletingId}
            inputCls={commentInputCls}
            onReplyChange={setReply}
            onPost={post}
            onDelete={remove}
            onNavigate={navigateToComment}
            onViewImages={(images, index) => setViewer({ images, index })}
          />
        ))}
        {merged.length === 0 && (
          <li className="text-sm text-neutral-400">还没有评论，来说两句？</li>
        )}
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
