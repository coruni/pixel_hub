"use client";

import Link from "next/link";
import { Gamepad2, Image as ImageIcon, Newspaper } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { createResourceAction, type ResourceActionState } from "@/lib/actions/resource";
import { ARTICLE_MEDIA_MAX, type UploadLimits } from "@/lib/upload-config";
import MdEditor from "@/components/rte/MdEditor";
import MediaPicker from "./media-picker";
import { ArticleSection, GameSection, ImageSection } from "./wizard-sections";
import { SquareCheckbox } from "../admin/SquareCheckbox";
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

/** 发布资源向导。limits 由宿主读取后台配置后传入，驱动体积/后缀提示动态化 */
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
  const [description, setDescription] = useState("");

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
    const maxCount =
      type === "ARTICLE" ? ARTICLE_MEDIA_MAX : limits.galleryImageMaxCount;
    const remain = maxCount - files.length;
    if (remain <= 0) {
      setUploadMsg(`最多上传 ${maxCount} 张`);
      return;
    }
    // Chevereto 上传接口一次请求仅接受单个文件：每个文件走独立请求，
    // 用 Promise.allSettled 并行发出多个「单文件」请求并逐个收集成败。
    const picks = Array.from(fl).slice(0, remain);
    setUploading(true);
    setUploadMsg(null);
    try {
      const settled = await Promise.allSettled(
        picks.map(async (f): Promise<{ ok: true; item: Uploaded } | { ok: false; error: string }> => {
          const fd = new FormData();
          fd.append("files", f);
          try {
            const res = await fetch(`/api/upload?max=${maxCount}`, { method: "POST", body: fd });
            const data = (await res.json()) as {
              ok?: boolean;
              error?: string;
              files?: Uploaded[];
            };
            const item = data.files?.[0];
            if (res.ok && data.ok && item?.ok) return { ok: true, item };
            console.warn(`[upload:client] 上传被拒 fileName=${f.name}`, { status: res.status, data });
            return { ok: false, error: item?.error ?? data.error ?? "上传失败" };
          } catch (err) {
            console.warn(`[upload:client] 请求失败 fileName=${f.name}`, err);
            return { ok: false, error: "网络错误，请重试" };
          }
        }),
      );
      const good: Uploaded[] = [];
      const bad: { name: string; error?: string }[] = [];
      for (let i = 0; i < settled.length; i += 1) {
        const r = settled[i]!;
        if (r.status === "rejected") {
          bad.push({ name: picks[i]!.name, error: "网络错误，请重试" });
        } else if (r.value.ok) {
          good.push(r.value.item);
        } else {
          bad.push({ name: picks[i]!.name, error: r.value.error });
        }
      }
      if (good.length > 0) {
        const next = [...files, ...good].slice(0, maxCount);
        setFiles(next);
        if (!coverId && next.length > 0) setCoverId(next[0].id);
      }
      if (bad.length > 0)
        setUploadMsg(`${bad.map((b) => b.name).join("、")} 上传失败：${bad[0]?.error ?? "未知原因"}`);
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
        免审用户直接上架，其他人等审核通过。
      </p>

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
            placeholder="输入标题"
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
            placeholder="卡片/详情页副标题"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel}>
            {type === "ARTICLE" ? "正文" : "详细描述"}
          </label>
          <MdEditor
            defaultValue=""
            onChange={setDescription}
            minHeight={type === "ARTICLE" ? "24rem" : "12rem"}
            ariaLabel={type === "ARTICLE" ? "正文" : "详细描述"}
          />
          <input type="hidden" name="description" value={description} />
          {fieldErr(state.fieldErrors?.description)}
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
              placeholder="空格或逗号分隔，如：像素风 开放世界"
              className={wizInput}
            />
          </div>
        </div>
      </section>

      {/* 按类型渲染对应分节 */}
      {type === "IMAGE" && <ImageSection fieldErrors={state.fieldErrors} limits={limits} />}
      {type === "ARTICLE" && <ArticleSection fieldErrors={state.fieldErrors} limits={limits} />}
      {type === "GAME" && (
        <GameSection fieldErrors={state.fieldErrors} limits={limits} showChangelog />
      )}

      {/* 图片上传（文章为可选插图） */}
      <MediaPicker
        files={files}
        coverId={coverId}
        uploading={uploading}
        isArticle={type === "ARTICLE"}
        maxMb={limits.galleryImageMaxMb}
        maxCount={
          type === "ARTICLE" ? ARTICLE_MEDIA_MAX : limits.galleryImageMaxCount
        }
        uploadMsg={uploadMsg}
        fieldError={state.fieldErrors?.mediaIds}
        onPick={onFiles}
        onRemove={remove}
        onSetCover={setCoverId}
        fileRef={fileRef}
      />

      <section className="mt-4 flex flex-wrap gap-x-6 gap-y-2 rounded-none border border-brand-200 bg-surface p-5 text-sm text-neutral-700">
        <SectionTitle n={4}>发布选项</SectionTitle>
        <label className="flex items-center gap-2">
          <SquareCheckbox name="nsfw" ariaLabel="NSFW" />
          NSFW（未登录与搜索引擎不可见）
        </label>
        <label className="flex items-center gap-2">
          <SquareCheckbox name="loginRequired" ariaLabel="下载需登录" />
          下载需登录
        </label>
        <label className="flex items-center gap-2">
          <SquareCheckbox name="allowComments" defaultChecked ariaLabel="允许评论" />
          允许评论
        </label>
        <label className="flex items-center gap-2">
          <SquareCheckbox name="isDownloadable" ariaLabel="提供下载" />
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
