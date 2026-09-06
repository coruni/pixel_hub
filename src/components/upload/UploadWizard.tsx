"use client";

import Link from "next/link";
import { Gamepad2, Image as ImageIcon, Newspaper } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { createResourceAction, type ResourceActionState } from "@/lib/actions/resource";
import type { UploadLimits } from "@/lib/upload-config";
import { uploadAttachment } from "@/lib/upload-attachment-client";
import MediaPicker from "./media-picker";
import { ArticleSection, AttachmentUpload, GameSection, ImageSection } from "./wizard-sections";
import {
  SectionTitle,
  fieldErr,
  wizInput,
  wizLabel,
  type Cat,
  type Uploaded,
} from "./wizard-shared";

const TYPES = [
  { k: "IMAGE", label: "图片", desc: "原创 / AI / 壁纸 / 截图", Icon: ImageIcon },
  { k: "GAME", label: "游戏", desc: "整包外链发布", Icon: Gamepad2 },
  { k: "ARTICLE", label: "文章", desc: "图文教程 / 心得 / 资讯", Icon: Newspaper },
] as const;

/** 发布资源向导：类型选择 + 基础信息 + 类型化信息 + 预览图上传 + 发布选项。
 *  limits 由服务端宿主读取后台配置后传入（见 app/upload/page.tsx），驱动各体积/后缀提示动态化 */
export default function UploadWizard({
  categories,
  limits,
}: {
  categories: Cat[];
  limits: UploadLimits;
}) {
  const [type, setType] = useState<"GAME" | "IMAGE" | "ARTICLE">("IMAGE");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [coverId, setCoverId] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [catId, setCatId] = useState("");
  // GAME：下载外链（受控，附件直传成功后回填站内路径）
  const [extUrl, setExtUrl] = useState("");
  const [attUploading, setAttUploading] = useState(false);
  const [attProgress, setAttProgress] = useState<number | null>(null);

  async function onAttachment(file: File | null) {
    if (!file) return;
    setAttUploading(true);
    setAttProgress(0);
    setUploadMsg(null);
    try {
      const data = await uploadAttachment(file, setAttProgress);
      setExtUrl(data.url);
    } catch {
      setUploadMsg("附件上传失败，请重试");
    } finally {
      setAttUploading(false);
      setAttProgress(null);
    }
  }

  const [state, formAction, pending] = useActionState<ResourceActionState, FormData>(
    createResourceAction,
    {},
  );

  const ids = files.filter((f) => f.ok).map((f) => f.id);

  function applyType(t: "GAME" | "IMAGE" | "ARTICLE") {
    setType(t);
    if (!categories.some((c) => c.id === catId)) setCatId("");
  }

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
        setUploadMsg(
          `${bad.map((b) => b.name).join("、")} 上传失败：${bad[0]?.error ?? "未知原因"}`,
        );
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
    <form action={formAction} className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">发布资源</h1>
      <p className="mt-2 rounded-none border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs leading-5 text-brand-800">
        支持图片、游戏（外链）与文章发布。可信用户免审直发，普通用户提交后进入审核队列。
      </p>

      {/* 隐藏字段 */}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="mediaIds" value={JSON.stringify(ids)} />
      <input type="hidden" name="coverId" value={coverId} />

      {/* 类型切换 */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {TYPES.map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => applyType(t.k)}
            aria-pressed={type === t.k}
            className={`flex items-center gap-3 rounded-none border p-3 text-left transition ${
              type === t.k
                ? "border-brand-600 bg-brand-500 text-white"
                : "border-brand-200 bg-surface text-neutral-500 hover:border-brand-400 hover:text-neutral-800"
            }`}
          >
            <t.Icon size={20} className="shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight">{t.label}</span>
              <span className="mt-0.5 block text-[11px] font-normal opacity-75">{t.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {/* 基础信息 */}
      <section className="mt-6 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
        <SectionTitle n={1}>基础信息</SectionTitle>
        <div>
          <label className={wizLabel} htmlFor="title">
            标题
          </label>
          <input
            id="title"
            name="title"
            required
            maxLength={80}
            placeholder="给内容起一个清晰的名字"
            className={wizInput}
          />
          {fieldErr(state.fieldErrors?.title)}
        </div>
        <div>
          <label className={wizLabel} htmlFor="summary">
            一句话简介（可选）
          </label>
          <input
            id="summary"
            name="summary"
            maxLength={160}
            placeholder="出现在卡片与详情页的副标题"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel} htmlFor="description">
            {type === "ARTICLE" ? "正文" : "详细描述"}
          </label>
          <textarea
            id="description"
            name="description"
            required
            rows={type === "ARTICLE" ? 12 : 5}
            maxLength={20000}
            placeholder={
              type === "ARTICLE"
                ? "文章正文（Markdown）……\n（至少 10 个字）"
                : "介绍内容、玩法/用途、使用方法、注意事项……\n（至少 10 个字）"
            }
            className={wizInput}
          />
          {fieldErr(state.fieldErrors?.description)}
          <p className="mt-1 text-xs leading-5 text-neutral-400">
            支持 Markdown 排版：空行分段；
            <code className="rounded-none bg-neutral-100 px-1">#</code> 标题、
            <code className="rounded-none bg-neutral-100 px-1">-</code> 列表、
            <code className="rounded-none bg-neutral-100 px-1">**加粗**</code>、
            <code className="rounded-none bg-neutral-100 px-1">`代码`</code>、
            <code className="rounded-none bg-neutral-100 px-1">[链接](地址)</code>。
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={wizLabel} htmlFor="categoryId">
              分类
            </label>
            <select
              id="categoryId"
              name="categoryId"
              value={catId}
              onChange={(e) => setCatId(e.target.value)}
              className={wizInput}
            >
              <option value="">选择分类…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {fieldErr(state.fieldErrors?.categoryId)}
          </div>
          <div>
            <label className={wizLabel} htmlFor="tags">
              标签
            </label>
            <input
              id="tags"
              name="tags"
              maxLength={400}
              placeholder="用空格/逗号分隔，如：像素风 开放世界"
              className={wizInput}
            />
          </div>
        </div>
      </section>

      {/* 类型化信息：图片 D2 声明+整包下载 / 游戏外链+版本 / 文章正文即内容+附件清单 */}
      {type === "IMAGE" && <ImageSection fieldErrors={state.fieldErrors} limits={limits} />}
      {type === "ARTICLE" && <ArticleSection fieldErrors={state.fieldErrors} limits={limits} />}
      {type === "GAME" && (
        <GameSection
          extUrl={extUrl}
          setExtUrl={setExtUrl}
          fieldErrors={state.fieldErrors}
          attachment={
            <AttachmentUpload
              uploading={attUploading}
              progress={attProgress}
              onUpload={onAttachment}
              filled={extUrl.startsWith("/")}
              limits={limits}
            />
          }
        />
      )}

      {/* 图片上传（文章为可选插图） */}
      <MediaPicker
        files={files}
        coverId={coverId}
        uploading={uploading}
        isArticle={type === "ARTICLE"}
        maxMb={limits.galleryImageMaxMb}
        uploadMsg={uploadMsg}
        fieldError={state.fieldErrors?.mediaIds}
        onPick={onFiles}
        onRemove={remove}
        onSetCover={setCoverId}
        fileRef={fileRef}
      />

      {/* 发布选项 */}
      <section className="mt-4 flex flex-wrap gap-x-6 gap-y-2 rounded-none border border-brand-200 bg-surface p-5 text-sm text-neutral-700">
        <SectionTitle n={4}>发布选项</SectionTitle>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="loginRequired" className="h-4 w-4 accent-brand-500" />
          下载需登录
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="allowComments"
            defaultChecked
            className="h-4 w-4 accent-brand-500"
          />
          允许评论
        </label>
      </section>

      {/* 提交 */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending || uploading}
          className="rounded-none border border-brand-600 bg-brand-500 px-8 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {pending
            ? "提交中…"
            : type !== "ARTICLE" && files.length === 0
              ? "先上传图片"
              : "提交发布"}
        </button>
        {state.ok && state.pending && (
          <span className="flex items-center gap-2 text-sm text-emerald-600">
            ✓ 已提交审核，通过后将自动上架
            <Link href="/" className="underline">
              返回首页
            </Link>
          </span>
        )}
        {state.error && <span className="text-sm text-red-500">{state.error}</span>}
      </div>
    </form>
  );
}
