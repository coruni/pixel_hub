"use client";

// 资源改稿表单（/admin/content/[id]/edit 与 /resources/[slug]/edit 共用）。
// 一律复用发布向导 /upload 的同一套组件与样式：
//   - wizInput / wizLabel / SectionTitle（wizard-shared）
//   - GameSection / ImageSection / ArticleSection（wizard-sections）按类型渲染分节
//   - MediaPicker + /api/upload 上传图片
// 保证「改稿」与「发布」在字段、样式、交互上完全一致。slug / 作者 / 计数 / 历史版本由服务端保持不变。
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import MdEditor from "@/components/rte/MdEditorLazy";

import { updateResourceAdminAction } from "@/lib/actions/admin-content";
import type { ResourceEditState, EditableResourceType } from "@/lib/actions/_resource-edit";
import type { ResourceMetaOutput } from "@/lib/meta";
import { ARTICLE_MEDIA_MAX, isSingleCoverType, type UploadLimits } from "@/lib/upload-config";
import { uploadImageFiles, type UploadProgress } from "@/lib/upload-image-client";
import {
  PublishOptionGrid,
  SectionTitle,
  STEP,
  fieldErr,
  wizInput,
  wizLabel,
  type Uploaded,
} from "@/components/upload/wizard-shared";
import MediaPicker from "@/components/upload/media-picker";
import { ArticleSection, GameSection, ImageSection } from "@/components/upload/wizard-sections";
import { AvSection } from "@/components/upload/av-section";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";

export type GalleryItem = {
  id: string;
  name: string;
  thumbUrl: string | null;
  bigUrl: string | null;
};

export type EditableResource = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  type: EditableResourceType;
  categoryId: string;
  externalUrl: string;
  tags: string;
  nsfw: boolean;
  loginRequired: boolean;
  allowComments: boolean;
  meta: ResourceMetaOutput;
  gallery: GalleryItem[];
  coverMediaId: string;
};

export function ResourceEditForm({
  resource,
  categories,
  action = updateResourceAdminAction,
  backHref = "/admin/content",
  backLabel = "返回内容库",
  limits,
}: {
  resource: EditableResource;
  categories: { id: string; name: string }[];
  action?: (prev: ResourceEditState, fd: FormData) => Promise<ResourceEditState>;
  backHref?: string;
  backLabel?: string;
  limits: UploadLimits;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fe = state.fieldErrors ?? {};

  // 媒体：以资源现有画廊预填，复用发布向导的选取/封面/移除交互
  const initialFiles: Uploaded[] = (resource.gallery ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    ok: true,
    thumbUrl: g.thumbUrl,
    bigUrl: g.bigUrl,
    origUrl: g.bigUrl,
    width: null,
    height: null,
  }));
  const [files, setFiles] = useState<Uploaded[]>(initialFiles);
  const [coverId, setCoverId] = useState(resource.coverMediaId || initialFiles[0]?.id || "");
  // 正文/描述走与发布向导同款 Markdown 编辑器（非受控），内容经 state 进 hidden input 提交
  const [description, setDescription] = useState(resource.description);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  /** 附件清单里在飞的上传任务数：>0 时禁止保存，等上传落地再提交 */
  const [attachBusy, setAttachBusy] = useState(0);
  /** 图片批量上传进度：显示「第 n / 共 m」与整体百分比 */
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ids = files.filter((f) => f.ok).map((f) => f.id);

  // IMAGE 旧数据可能只有单 download（图包），新数据用 downloads 数组；编辑预填统一转成数组
  const legacyImageDownloads =
    resource.meta.kind === "IMAGE"
      ? resource.meta.download && resource.meta.download.mode !== "none" && resource.meta.download.url
        ? [
            {
              name: resource.meta.download.fileName || "图包",
              kind: resource.meta.download.mode,
              url: resource.meta.download.url,
              size: resource.meta.download.size || "",
            },
          ]
        : (resource.meta.downloads ?? [])
      : [];

  async function onFiles(fl: FileList | null) {
    if (!fl || fl.length === 0) return;
    const maxCount = isSingleCoverType(resource.type)
      ? ARTICLE_MEDIA_MAX
      : limits.galleryImageMaxCount;
    const remain = maxCount - files.length;
    if (remain <= 0) {
      setUploadMsg(`最多上传 ${maxCount} 张`);
      return;
    }
    // 每个文件走独立请求：服务端 /api/upload 一次只接收一个源文件。
    // 并发上限、单请求超时、退避重试，以及「非 JSON 响应（如反代 524 的空体）如何解释」，
    // 统一收敛在 lib/upload-image-client，与发布向导共用同一份策略。
    const picks = Array.from(fl).slice(0, remain);
    setUploading(true);
    setUploadMsg(null);
    setProgress({ done: 0, total: picks.length, index: 0, name: picks[0]?.name ?? "" });
    try {
      const { good, bad } = await uploadImageFiles(picks, maxCount, {
        onProgress: setProgress,
      });
      if (good.length > 0) {
        const next = [...files, ...good].slice(0, maxCount);
        setFiles(next);
        if (!coverId && next.length > 0) setCoverId(next[0].id);
      }
      if (bad.length > 0)
        setUploadMsg(`${bad.map((b) => b.name).join("、")} 上传失败：${bad[0]?.error ?? "未知原因"}`);
    } finally {
      setUploading(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function remove(id: string) {
    const next = files.filter((f) => f.id !== id);
    setFiles(next);
    if (coverId === id) setCoverId(next.find((f) => f.ok)?.id ?? "");
  }

  // ---- 视频自动封面（与发布向导同一套语义：自动值可覆盖自动值，不抢手选封面） ----
  const coverIdRef = useRef(coverId);
  useEffect(() => {
    coverIdRef.current = coverId;
  });
  const autoCoverId = useRef("");

  const onCoverFrame = useCallback(async (frame: File) => {
    const cur = coverIdRef.current;
    if (cur && cur !== autoCoverId.current) return;
    const stale = autoCoverId.current;
    setUploading(true);
    setUploadMsg("正在从视频生成封面…");
    setProgress({ done: 0, total: 1, index: 0, name: frame.name });
    try {
      const { good, bad } = await uploadImageFiles([frame], ARTICLE_MEDIA_MAX, {
        onProgress: setProgress,
      });
      const item = good[0];
      if (!item) {
        setUploadMsg(bad[0]?.error ?? "封面生成失败，可手动上传封面");
        return;
      }
      autoCoverId.current = item.id;
      setFiles((prev) => [item, ...prev.filter((f) => f.id !== stale)].slice(0, ARTICLE_MEDIA_MAX));
      setCoverId(item.id);
      setUploadMsg(null);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }, []);

  // 「返回」目标本身就是资源的公开页时（作者自己的编辑页正是如此，backHref = /resources/[slug]），
  // 再渲染「查看公开页」就是两个指向同一 URL 的入口 —— 只保留返回按钮那一个。
  const publicHref = `/resources/${resource.slug}`;
  const showPublicLink = backHref !== publicHref;

  return (
    <form
      action={formAction}
      // 附件还在上传就拦下这次保存：不能把半截清单写进库
      onSubmit={(e) => {
        if (attachBusy > 0) {
          e.preventDefault();
          setUploadMsg("附件正在上传，请等上传完成后再保存");
        }
      }}
    >
      <input type="hidden" name="id" value={resource.id} />
      <input type="hidden" name="mediaIds" value={JSON.stringify(ids)} />
      <input type="hidden" name="coverId" value={coverId} />

      {/* 基础信息（与发布向导分节一致） */}
      <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
        <SectionTitle n={STEP.BASIC}>基础信息</SectionTitle>
        <div>
          <label className={wizLabel} htmlFor="title">
            标题
          </label>
          <input
            id="title"
            name="title"
            required
            defaultValue={resource.title}
            maxLength={80}
            className={wizInput}
          />
          {fieldErr(fe.title)}
        </div>
        <div>
          <label className={wizLabel} htmlFor="summary">
            一句话简介（可选）
          </label>
          <input
            id="summary"
            name="summary"
            defaultValue={resource.summary}
            maxLength={160}
            placeholder="卡片/详情页副标题"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel}>
            {resource.type === "ARTICLE" ? "正文" : "详细描述"}
          </label>
          <MdEditor
            defaultValue={resource.description}
            onChange={setDescription}
            minHeight={resource.type === "ARTICLE" ? "24rem" : "12rem"}
            ariaLabel={resource.type === "ARTICLE" ? "正文" : "详细描述"}
          />
          <input type="hidden" name="description" value={description} />
          {fieldErr(fe.description)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={wizLabel} htmlFor="categoryId">
              分类
            </label>
            <select
              id="categoryId"
              name="categoryId"
              defaultValue={resource.categoryId}
              className={wizInput}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {fieldErr(fe.categoryId)}
          </div>
          <div>
            <label className={wizLabel} htmlFor="tags">
              标签
            </label>
            <input
              id="tags"
              name="tags"
              defaultValue={resource.tags}
              placeholder="空格或逗号分隔，如：像素风 开放世界"
              className={wizInput}
            />
            {fieldErr(fe.tags)}
          </div>
        </div>
      </section>

      {/* 按类型渲染对应分节（与发布向导同一套组件，保证字段/样式/交互一致） */}
      {resource.type === "GAME" && resource.meta.kind === "GAME" && (
        <GameSection
          downloads={resource.meta.downloads.map((d) => ({ name: d.name, url: d.url }))}
          fieldErrors={fe}
          limits={limits}
          onBusyChange={setAttachBusy}
        />
      )}
      {resource.type === "IMAGE" && resource.meta.kind === "IMAGE" && (
        <ImageSection
          initial={{
            isAiGenerated: resource.meta.isAiGenerated,
            original: resource.meta.original,
            downloads: legacyImageDownloads,
          }}
          fieldErrors={fe}
          limits={limits}
          onBusyChange={setAttachBusy}
        />
      )}
      {resource.type === "ARTICLE" && resource.meta.kind === "ARTICLE" && (
        <ArticleSection
          initial={{ downloads: resource.meta.downloads }}
          fieldErrors={fe}
          limits={limits}
          onBusyChange={setAttachBusy}
        />
      )}
      {resource.type === "MUSIC" && resource.meta.kind === "MUSIC" && (
        <AvSection
          avKind="audio"
          initial={resource.meta}
          fieldErrors={fe}
          limits={limits}
          onBusyChange={setAttachBusy}
        />
      )}
      {resource.type === "VIDEO" && resource.meta.kind === "VIDEO" && (
        <AvSection
          avKind="video"
          initial={resource.meta}
          fieldErrors={fe}
          limits={limits}
          onBusyChange={setAttachBusy}
          onCoverFrame={onCoverFrame}
        />
      )}

      {/* 图片上传（与发布向导同一组件；游戏/文章/音乐/视频为单张封面） */}
      <MediaPicker
        files={files}
        coverId={coverId}
        uploading={uploading}
        isArticle={resource.type === "ARTICLE"}
        singleCover={isSingleCoverType(resource.type)}
        maxMb={limits.galleryImageMaxMb}
        maxCount={isSingleCoverType(resource.type) ? ARTICLE_MEDIA_MAX : limits.galleryImageMaxCount}
        uploadMsg={uploadMsg}
        progress={progress}
        fieldError={fe.mediaIds}
        onPick={onFiles}
        onRemove={remove}
        onSetCover={setCoverId}
        fileRef={fileRef}
      />

      {/* 可见性与互动：与 /upload「发布选项」同款布局与文案（共用 PublishOptionGrid） */}
      <section className="mt-4 rounded-none border border-brand-200 bg-surface p-5">
        <SectionTitle n={STEP.OPTIONS}>可见性与互动</SectionTitle>
        <PublishOptionGrid checkedOf={(name) => resource[name]} />
      </section>

      {/* 提交 */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          disabled={pending || uploading || attachBusy > 0}
          variant="primary" size="md"
        >
          {pending ? "保存中…" : attachBusy > 0 ? "等待附件上传…" : "保存修改"}
        </Button>
        {attachBusy > 0 && (
          <span className="text-sm text-amber-600">附件上传中，完成后才能保存</span>
        )}
        <ButtonLink href={backHref} variant="ghost">
          {backLabel}
        </ButtonLink>
        {showPublicLink && (
          <Link href={publicHref} className="text-xs text-neutral-400 hover:text-brand-700">
            查看公开页
          </Link>
        )}
        {state.error && <span className="text-sm text-red-500">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-600">✓ 已保存</span>}
      </div>
    </form>
  );
}
