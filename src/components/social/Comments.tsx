"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, X } from "lucide-react";
import { CrepeFeature } from "@milkdown/crepe";
import { addCommentAction, deleteCommentAction, loadRepliesAction, loadRootCommentsAction } from "@/lib/actions/social";
import ImageViewer from "@/components/ui/ImageViewer";
import MdEditor from "@/components/rte/MdEditor";
import { useFileDrop } from "@/lib/hooks/use-file-drop";
import { useFilePaste } from "@/lib/hooks/use-file-paste";
import { confirmDialog, toast } from "@/components/ui/feedback";
import CommentItem, { commentInputCls, type ReplyState } from "./comment-item";
import { CommentsPager } from "./CommentPager";
import { flashComment, useCommentPolling } from "./use-comment-polling";
import {
  totalPagesOf,
  type CommentImage,
  type CommentShape,
  type CommentsPaging,
} from "./comment-types";
import { Button } from "@/components/ui/Button";

export type { CommentAuthor, CommentImage, CommentShape } from "./comment-types";

/** 评论正文长度上限，与 social.ts 的 commentSchema.max(2000) 同口径（按 Markdown 源码字符数） */
const COMMENT_MAX = 2000;
/** 剩余多少字开始提示 */
const COMMENT_WARN_AT = 200;

/** 评论编辑器：关掉图片块（不提供上传入口）、表格、工具栏与块操作柄，只保留基础 Markdown 语法。
 *  ImageBlock 关闭后斜杠菜单的 Image 项自动消失；BlockEdit 关闭会连同 / 斜杠菜单一起去掉
 *  （评论框只有 6rem 高，块操作柄会溢到框外，且靠手打语法足够）。
 *  手打 ![alt](url) 仍可生成行内图，该风险在渲染层用图片域名白名单兜底。 */
const COMMENT_FEATURES: Partial<Record<CrepeFeature, boolean>> = {
  [CrepeFeature.ImageBlock]: false,
  [CrepeFeature.Table]: false,
  [CrepeFeature.BlockEdit]: false,
};

/** 资源评论区：主楼发布框（带附图）+ 评论树（根楼层与子评论各自分页）+ 增量轮询 */
export default function Comments({
  resourceId,
  canPost,
  viewerId,
  isStaff,
  comments,
  commentsPaging,
  imageMax,
}: {
  resourceId: string;
  canPost: boolean;
  viewerId?: string;
  isStaff?: boolean;
  /** 服务端下发的第 1 页根楼层 */
  comments: CommentShape[];
  /** 与 comments 配套的分页元信息 */
  commentsPaging: CommentsPaging;
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

  // ---- 分页：列表状态由本组件持有，实时 hook 只负责往上打补丁 ----
  const [merged, setMerged] = useState<CommentShape[]>(comments);
  const [page, setPage] = useState(commentsPaging.page);
  const [paging, setPaging] = useState<CommentsPaging>(commentsPaging);
  const [pagePending, setPagePending] = useState(false);
  /** 正在切换回复页的根楼层 id：同屏只允许一个，避免并发覆盖 */
  const [repliesPendingId, setRepliesPendingId] = useState<string | null>(null);

  // 服务端重新下发（发帖后的 router.refresh）→ 本地回到服务端给的那一页
  const [baseComments, setBaseComments] = useState(comments);
  const [basePaging, setBasePaging] = useState(commentsPaging);
  if (baseComments !== comments) {
    setBaseComments(comments);
    setMerged(comments);
  }
  if (basePaging !== commentsPaging) {
    setBasePaging(commentsPaging);
    setPage(commentsPaging.page);
    setPaging(commentsPaging);
  }

  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  /** 重拉当前页：实时侧的删除 / 审核兜底走这里，避免把用户从第 N 页弹回第 1 页 */
  const reload = useCallback(async () => {
    const res = await loadRootCommentsAction({ resourceId, page: pageRef.current });
    if (!res.ok) return;
    setMerged(res.roots);
    setPage(res.paging.page);
    setPaging({ ...res.paging, commentTotal: res.commentTotal });
  }, [resourceId]);

  useCommentPolling({
    resourceId,
    comments: merged,
    setComments: setMerged,
    // 基准只跟服务端下发的那一页走，不随本地合并变化
    sinceResetKey: comments,
    page,
    onReload: reload,
    onAdded: (n) => setPaging((p) => ({ ...p, commentTotal: p.commentTotal + n })),
  });

  /** 根楼层翻页：整页替换，并把评论区滚回顶部 */
  async function goPage(next: number) {
    if (pagePending || next < 1 || next === page) return;
    setPagePending(true);
    const res = await loadRootCommentsAction({ resourceId, page: next });
    setPagePending(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    setMerged(res.roots);
    setPage(res.paging.page);
    setPaging({ ...res.paging, commentTotal: res.commentTotal });
    document.getElementById("comments")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** 子评论翻页：只替换该根楼层的回复，其它楼层不动 */
  async function goRepliesPage(rootId: string, next: number) {
    if (repliesPendingId) return;
    setRepliesPendingId(rootId);
    const res = await loadRepliesAction({ rootId, page: next });
    setRepliesPendingId(null);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    setMerged((prev) =>
      prev.map((c) =>
        c.id === rootId ? { ...c, replies: res.replies, repliesPaging: res.paging } : c,
      ),
    );
  }

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
    if (!list || list.length === 0) return;
    const next = [...files, ...Array.from(list)].slice(0, imageMax);
    setFiles(next);
    syncPreviews(next);
  }

  /** 预览 URL 与 files 一一对应地重建：先释放旧的再建新，避免反复增删持续泄漏 blob */
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

  // 拖入 / Ctrl+V 附图：与点击选择同一条链路，直送 pickImages。
  // imageMax 为 0（后台关闭附图）或已达上限时关掉，避免拖进来的图片被静默丢弃。
  const imagesFull = imageMax <= 0 || files.length >= imageMax;
  const { dragging, dropProps } = useFileDrop({
    onFiles: pickImages,
    disabled: sending || imagesFull,
  });
  const { pasteProps } = useFilePaste({
    onFiles: pickImages,
    disabled: sending,
    enabled: imageMax > 0 && !imagesFull,
  });

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
    // 删的是根楼层时提醒回复的去向：回复不会一起消失，会上移成独立评论
    // （口径见 comments-paging 的 rootFloorWhere）。这里取该根的总回复数，不是当前页的条数。
    const replies = merged.find((c) => c.id === commentId)?.repliesPaging.total ?? 0;
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
      // 成功或结果未知都重拉：服务端可能已经删掉了，让列表回到真实状态。
      // 走 reload 而不是 router.refresh，避免把用户从第 N 页弹回第 1 页。
      void reload();
    }
  }

  // 总数含楼中楼回复，由服务端给：本地只加载了一部分，自己数会少
  const total = paging.commentTotal;

  return (
    <section id="comments" className="mt-10 scroll-mt-24 border-t border-neutral-200 pt-8">
      <h2 className="text-lg font-semibold text-neutral-900">评论（{total}）</h2>

      {error && (
        <p className="mt-3 rounded-none bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {canPost ? (
        // 整个输入区即投放目标：拖到编辑器上、预览缩略图上、按钮上都算数，
        // 不必对准某个小格子。pasteProps 同理——在框内 Ctrl+V 截图即成为附图。
        <div
          className="relative mt-4"
          onKeyDown={onComposerKeyDown}
          {...dropProps}
          {...pasteProps}
        >
          {dragging && (
            // 拖拽期间整块盖一层提示：像素站点不用毛玻璃，走实心 brand-50 + 虚线描边
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center border-2 border-dashed border-brand-500 bg-brand-50/95">
              <span className="text-sm font-medium text-brand-700">松开即可添加附图</span>
            </div>
          )}
          <MdEditor
            key={editorKey}
            defaultValue=""
            onChange={setText}
            minHeight="6rem"
            ariaLabel="发表评论"
            placeholder="友善发言，说说你的看法… 支持 Markdown 基础语法"
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
          {/* 附图：两种形态互斥渲染。
              - 无图：只显示「附图 0/N」入口按钮
              - 有图：按钮让位给缩略图行，末尾的虚线方框接管入口并显示剩余额度
              imageMax = 0（后台关闭附图）时整块不渲染。 */}
          {imageMax > 0 && (
          <div className="mt-2">
            <input
              ref={fileRef}
              id="comment-image-input"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              disabled={sending || imagesFull}
              hidden
              onChange={(e) => pickImages(e.target.files)}
            />
            {files.length === 0 ? (
              <label
                htmlFor="comment-image-input"
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-none border bg-surface px-3 py-1.5 text-xs transition ${
                  dragging
                    ? "border-brand-500 text-brand-700"
                    : "border-brand-200 text-neutral-600 hover:border-brand-500 hover:text-neutral-900"
                }`}
              >
                <ImagePlus size={14} aria-hidden />
                附图 0/{imageMax}
              </label>
            ) : (
              <div className="flex flex-wrap items-start gap-2">
                {previews.map((src, i) => (
                  <span key={src} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`待上传的附图 ${i + 1}`}
                      className="h-20 w-20 rounded-none border border-brand-200 object-cover"
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
                {/* 添加方框：唯一的入口（点击 / 拖入 / 粘贴）；额度用完就不渲染，
                    与 useFileDrop/useFilePaste 的 disabled 条件同步，避免「框还在但拖进去没反应」 */}
                {!imagesFull && (
                  <label
                    htmlFor="comment-image-input"
                    className={`grid h-20 w-20 cursor-pointer place-items-center rounded-none border-2 border-dashed text-center transition ${
                      dragging
                        ? "border-brand-600 bg-brand-100 text-brand-700"
                        : "border-brand-300 bg-brand-50/40 text-brand-700 hover:border-brand-500 hover:bg-brand-50"
                    }`}
                  >
                    <span className="px-1 text-[11px] leading-tight">
                      {dragging ? "松开即可" : "＋ 添加"}
                      <span className="mt-0.5 block font-normal text-[10px] opacity-70">
                        拖入或粘贴 {files.length}/{imageMax}
                      </span>
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>
          )}
          <div className="mt-2 flex items-center justify-end gap-3">
            
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
            repliesPending={repliesPendingId === c.id}
            onReplyChange={setReply}
            onPost={post}
            onDelete={remove}
            onNavigate={navigateToComment}
            onRepliesPage={goRepliesPage}
            onViewImages={(images, index) => setViewer({ images, index })}
          />
        ))}
        {merged.length === 0 && (
          <li className="text-sm text-neutral-400">
            {totalPagesOf(paging) > 1 ? "这一页没有评论。" : "还没有评论，来说两句？"}
          </li>
        )}
      </ul>

      {/* 只有多页时才给分页器：单页摆个「1/1」只是噪音 */}
      {totalPagesOf(paging) > 1 && (
        <CommentsPager paging={paging} commentTotal={total} pending={pagePending} onChange={goPage} />
      )}

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
