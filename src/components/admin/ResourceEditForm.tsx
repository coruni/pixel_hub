"use client";

// 资源改稿表单（/admin/content/[id]/edit 与 /resources/[slug]/edit 共用）。
// 一律复用发布向导 /upload 的同一套组件与样式：
//   - wizInput / wizLabel / SectionTitle（wizard-shared）
//   - GameSection / ImageSection / ArticleSection（wizard-sections）按类型渲染分节
//   - MediaPicker + /api/upload 上传图片
// 保证「改稿」与「发布」在字段、样式、交互上完全一致。slug / 作者 / 计数 / 历史版本由服务端保持不变。
import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { BTN_GHOST_SM } from "@/lib/ui/cls";
import { updateResourceAdminAction } from "@/lib/actions/admin-content";
import type { ResourceEditState } from "@/lib/actions/_resource-edit";
import type { ResourceMetaOutput } from "@/lib/meta";
import type { UploadLimits } from "@/lib/upload-config";
import {
  fieldErr,
  SectionTitle,
  wizInput,
  wizLabel,
  type Uploaded,
} from "@/components/upload/wizard-shared";
import { SquareCheckbox } from "./SquareCheckbox";
import MediaPicker from "@/components/upload/media-picker";
import { ArticleSection, GameSection, ImageSection } from "@/components/upload/wizard-sections";

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
  type: "GAME" | "IMAGE" | "ARTICLE";
  categoryId: string;
  externalUrl: string;
  tags: string;
  nsfw: boolean;
  loginRequired: boolean;
  allowComments: boolean;
  isDownloadable: boolean;
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
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
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
    setUploading(true);
    setUploadMsg(null);
    const fd = new FormData();
    for (const f of Array.from(fl)) fd.append("files", f);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) {
        setUploadMsg(data.error ?? "上传失败");
        return;
      }
      const list = (data.files ?? []) as Uploaded[];
      const good = list.filter((f) => f.ok);
      const bad = list.filter((f) => !f.ok);
      if (good.length > 0) {
        const next = [...files, ...good].slice(0, 12);
        setFiles(next);
        if (!coverId && next.length > 0) setCoverId(next[0].id);
      }
      if (bad.length > 0)
        setUploadMsg(`${bad.map((b) => b.name).join("、")} 上传失败：${bad[0]?.error ?? "未知原因"}`);
    } catch {
      setUploadMsg("上传失败，请检查网络后重试");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function remove(id: string) {
    const next = files.filter((f) => f.id !== id);
    setFiles(next);
    if (coverId === id) setCoverId(next.find((f) => f.ok)?.id ?? "");
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={resource.id} />
      <input type="hidden" name="mediaIds" value={JSON.stringify(ids)} />
      <input type="hidden" name="coverId" value={coverId} />

      {/* 基础信息（与发布向导分节一致） */}
      <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
        <SectionTitle n={1}>基础信息</SectionTitle>
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
          <label className={wizLabel} htmlFor="description">
            {resource.type === "ARTICLE" ? "正文" : "详细描述"}
          </label>
          <textarea
            id="description"
            name="description"
            required
            defaultValue={resource.description}
            rows={resource.type === "ARTICLE" ? 12 : 5}
            maxLength={20000}
            placeholder={
              resource.type === "ARTICLE"
                ? "正文（Markdown），至少 10 字"
                : "玩法/用途/方法/注意事项……至少 10 字"
            }
            className={wizInput}
          />
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
          initial={{
            externalUrl: resource.externalUrl,
            version: resource.meta.version,
            size: resource.meta.size,
            platforms: resource.meta.platforms?.join(","),
            lang: resource.meta.lang,
            license: resource.meta.license,
            note: resource.meta.note,
          }}
          fieldErrors={fe}
          limits={limits}
        />
      )}
      {resource.type === "IMAGE" && resource.meta.kind === "IMAGE" && (
        <ImageSection
          initial={{
            isAiGenerated: resource.meta.isAiGenerated,
            original: resource.meta.original,
            aiTool: resource.meta.aiTool,
            aiModel: resource.meta.aiModel,
            license: resource.meta.license,
            sourceNote: resource.meta.sourceNote,
            downloads: legacyImageDownloads,
          }}
          fieldErrors={fe}
          limits={limits}
        />
      )}
      {resource.type === "ARTICLE" && resource.meta.kind === "ARTICLE" && (
        <ArticleSection initial={{ downloads: resource.meta.downloads }} fieldErrors={fe} limits={limits} />
      )}

      {/* 图片上传（与发布向导同一组件） */}
      <MediaPicker
        files={files}
        coverId={coverId}
        uploading={uploading}
        isArticle={resource.type === "ARTICLE"}
        maxMb={limits.galleryImageMaxMb}
        uploadMsg={uploadMsg}
        fieldError={fe.mediaIds}
        onPick={onFiles}
        onRemove={remove}
        onSetCover={setCoverId}
        fileRef={fileRef}
      />

      {/* 可见性与互动（与发布向导「发布选项」同款 section + SectionTitle 样式） */}
      <section className="mt-4 flex flex-wrap gap-x-6 gap-y-2 rounded-none border border-brand-200 bg-surface p-5 text-sm text-neutral-700">
        <SectionTitle n={4}>可见性与互动</SectionTitle>
        <label className="flex items-center gap-2">
          <SquareCheckbox name="nsfw" defaultChecked={resource.nsfw} ariaLabel="NSFW" />
          NSFW（未登录与搜索引擎不可见）
        </label>
        <label className="flex items-center gap-2">
          <SquareCheckbox name="loginRequired" defaultChecked={resource.loginRequired} ariaLabel="下载需登录" />
          下载需登录
        </label>
        <label className="flex items-center gap-2">
          <SquareCheckbox name="allowComments" defaultChecked={resource.allowComments} ariaLabel="允许评论" />
          允许评论
        </label>
        <label className="flex items-center gap-2">
          <SquareCheckbox name="isDownloadable" defaultChecked={resource.isDownloadable} ariaLabel="提供下载" />
          提供下载
        </label>
      </section>

      {/* 提交 */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending || uploading}
          className="rounded-none border border-brand-600 bg-brand-500 px-8 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存修改"}
        </button>
        <Link href={backHref} className={BTN_GHOST_SM}>
          {backLabel}
        </Link>
        <Link
          href={`/resources/${resource.slug}`}
          className="text-xs text-neutral-400 hover:text-brand-700"
        >
          查看公开页
        </Link>
        {state.error && <span className="text-sm text-red-500">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-600">✓ 已保存</span>}
      </div>
    </form>
  );
}
