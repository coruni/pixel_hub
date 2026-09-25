"use client";

import Link from "next/link";
import {
  ChevronRight,
  Film,
  Gamepad2,
  Image as ImageIcon,
  Music,
  Newspaper,
  Save,
} from "lucide-react";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { createResourceAction, type ResourceActionState } from "@/lib/actions/resource";
import { saveDraftAction } from "@/lib/actions/draft";
import {
  ARTICLE_MEDIA_MAX,
  isSingleCoverType,
  type UploadLimits,
} from "@/lib/upload-config";
import { uploadImageFiles, type UploadProgress } from "@/lib/upload-image-client";
import {
  DRAFT_AUTOSAVE_DELAY,
  DRAFT_AUTOSAVE_INTERVAL,
  collectDraft,
  draftHasContent,
  draftPayloadSchema,
  draftTimeText,
  type DraftPayload,
} from "@/lib/draft";
import MdEditor from "@/components/rte/MdEditor";
import MediaPicker from "./media-picker";
import { ArticleSection, GameSection, ImageSection, type AttachRow } from "./wizard-sections";
import { AvSection } from "./av-section";
import {
  MODE_STEP,
  PublishOptionGrid,
  SectionTitle,
  STEP,
  fieldErr,
  wizInput,
  wizLabel,
  type Cat,
  type Uploaded,
} from "./wizard-shared";
import { Button } from "@/components/ui/Button";

/** 发布向导支持的五种内容形态；音乐/视频为「挂载在线音视频 / 上传来源文件」两类新入口 */
type WizardType = "GAME" | "IMAGE" | "ARTICLE" | "MUSIC" | "VIDEO";

const TYPES = [
  { k: "IMAGE", label: "图片", desc: "原创 / AI / 壁纸 / 截图", Icon: ImageIcon },
  { k: "GAME", label: "游戏", desc: "整包外链发布", Icon: Gamepad2 },
  { k: "ARTICLE", label: "文章", desc: "图文教程 / 心得 / 资讯", Icon: Newspaper },
  { k: "MUSIC", label: "音乐", desc: "在线挂载 / 上传音频", Icon: Music },
  { k: "VIDEO", label: "视频", desc: "在线挂载 / 上传视频", Icon: Film },
] as const satisfies readonly { k: WizardType; label: string; desc: string; Icon: typeof Music }[];

/** 草稿快照 → 附件清单行（坏 JSON 一律当空清单） */
function downloadsOf(p: DraftPayload): AttachRow[] {
  try {
    const arr = JSON.parse(p.downloads || "[]");
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .map((d, i) => ({
        key: `draft-${i}-${String(d.url ?? "")}`,
        name: String(d.name ?? ""),
        kind: d.kind === "file" ? "file" : "link",
        url: String(d.url ?? ""),
        size: String(d.size ?? ""),
      }));
  } catch {
    return [];
  }
}

/**
 * 发布资源向导。limits 由宿主读取后台配置后传入，驱动体积/后缀提示动态化。
 *
 * 草稿：打开页面即带上服务端读到的 autoSave 开关与草稿条数；
 * 若 URL 带 ?draft=<id>，宿主会把草稿快照作为 initialDraft 传进来，表单一进来就是上次填的内容。
 */
export default function UploadWizard({
  categories,
  limits,
  autoSave: autoSaveProp,
  draftCount,
  initialDraft,
}: {
  categories: Cat[];
  limits: UploadLimits;
  autoSave: boolean;
  draftCount: number;
  initialDraft?: { id: string; payload: DraftPayload; updatedAt: string } | null;
}) {
  const d = initialDraft?.payload ?? null;
  // 草稿恢复：类型直接落到草稿里的类型，省掉再选一次模式。
  // 兼容旧草稿：GAME 以前可能保存过多张预览图，切换为单封面语义时只保留封面。
  const draftType = d?.type ?? null;
  const draftFiles = d ? (d.media as Uploaded[]) : [];
  const draftCoverId = d?.coverId ?? "";
  const draftMedia =
    draftType && isSingleCoverType(draftType)
      ? (() => {
          const cover = draftFiles.find((f) => f.ok && f.id === draftCoverId) ?? draftFiles.find((f) => f.ok);
          return cover ? [cover] : [];
        })()
      : draftFiles;
  const draftCover = draftMedia.find((f) => f.id === draftCoverId)?.id ?? draftMedia[0]?.id ?? "";
  const [type, setType] = useState<WizardType | null>(draftType);
  const [files, setFiles] = useState<Uploaded[]>(draftMedia);
  const [coverId, setCoverId] = useState<string>(draftCover);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  /** 图片批量上传进度：显示「第 n / 共 m」与整体百分比 */
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState(d?.description ?? "");
  /** 附件清单里在飞的上传任务数：>0 时禁止提交，等上传落地再提交 */
  const [attachBusy, setAttachBusy] = useState(0);

  const [state, formAction, pending] = useActionState<ResourceActionState, FormData>(
    createResourceAction,
    {},
  );

  // ---- 草稿自动保存 ----
  const formRef = useRef<HTMLFormElement>(null);
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const [savedAt, setSavedAt] = useState<string | null>(initialDraft?.updatedAt ?? null);
  // 自动保存开关只读：开关本体在「账户设置 · 发布」，向导里不再提供，避免两处状态打架
  const autoSave = autoSaveProp;
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  // 表单里的非受控输入（各分节字段）不会进 React state，用表单级事件把它变成可依赖的信号
  const [formTick, setFormTick] = useState(0);
  // 最新状态镜像：防抖回调在 setTimeout 里执行，直接读 state 会拿到闭包里的旧值
  const latest = useRef({ files, coverId, description, type });
  useEffect(() => {
    latest.current = { files, coverId, description, type };
  });
  // 已落库快照的签名：内容没变就不重复写库
  const savedSig = useRef<string | null>(initialDraft ? JSON.stringify(d) : null);
  const inflight = useRef(false);

  const ids = files.filter((f) => f.ok).map((f) => f.id);
  const singleCover = type !== null && isSingleCoverType(type);
  const isArticle = type === "ARTICLE";
  const mediaMax = singleCover ? ARTICLE_MEDIA_MAX : limits.galleryImageMaxCount;

  function applyType(t: WizardType) {
    setType(t);
    if (!isSingleCoverType(t)) return;
    // 从 IMAGE 切到 GAME/ARTICLE 时，旧的多张预览图只保留当前封面，避免提交时被服务端拒绝。
    const cover = files.find((f) => f.ok && f.id === coverId) ?? files.find((f) => f.ok);
    const next = cover ? [cover] : [];
    setFiles(next);
    setCoverId(cover?.id ?? "");
  }

  const persist = useCallback(
    async (manual: boolean) => {
      const cur = latest.current;
      if (!cur.type) return;
      if (inflight.current) return;
      const parsed = draftPayloadSchema.safeParse(
        collectDraft(formRef.current, cur.files, cur.coverId, cur.type),
      );
      if (!parsed.success) return;
      // 空草稿不落库：只是打开页面看一下不该生成记录
      if (!draftHasContent(parsed.data)) return;
      const sig = JSON.stringify(parsed.data);
      if (!manual && sig === savedSig.current) return;
      inflight.current = true;
      setSaveState("saving");
      try {
        const res = await saveDraftAction({ id: draftId, payload: parsed.data });
        if (res.ok) {
          savedSig.current = sig;
          setDraftId(res.id);
          setSavedAt(res.savedAt);
          setSaveState("saved");
          setSaveMsg(manual ? "草稿已保存" : null);
        } else {
          setSaveState("error");
          setSaveMsg(res.error);
        }
      } catch {
        setSaveState("error");
        setSaveMsg("草稿保存失败");
      } finally {
        inflight.current = false;
      }
    },
    [draftId],
  );

  // 受控 state（媒体、封面、正文）与表单事件都作为「改过了」的信号；停止输入后写一次
  useEffect(() => {
    if (!type || !autoSave) return;
    const timer = setTimeout(() => {
      void persist(false);
    }, DRAFT_AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
    // 分类是非受控字段，改动由 form 级 onChange/formTick 捕获，无需单独依赖
  }, [formTick, files, coverId, description, autoSave, type, persist]);

  // 兜底周期：手别停时防抖计时器永远等不到「停手」，这里按点存一次（内容没变时 persist 内部会跳过）
  useEffect(() => {
    if (!type || !autoSave) return;
    const timer = setInterval(() => {
      void persist(false);
    }, DRAFT_AUTOSAVE_INTERVAL);
    return () => clearInterval(timer);
  }, [autoSave, type, persist]);

  // Ctrl/Cmd+S：拦掉浏览器「保存网页」，改为立即写一次草稿（capture 阶段抢在编辑器快捷键之前）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (!latest.current.type) return; // 还在选类型，没内容可存
      void persist(true);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [persist]);

  async function onFiles(fl: FileList | null) {
    if (!fl || fl.length === 0) return;
    const maxCount = singleCover ? ARTICLE_MEDIA_MAX : limits.galleryImageMaxCount;
    const remain = maxCount - files.length;
    if (remain <= 0) {
      setUploadMsg(`最多上传 ${maxCount} 张`);
      return;
    }
    // 每个文件走独立请求：服务端 /api/upload 一次只接收一个源文件。
    // 并发上限、单请求超时、退避重试，以及「非 JSON 响应（如反代 524 的空体）如何解释」，
    // 统一收敛在 lib/upload-image-client，两处调用点共用同一份策略。
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

  // ---- 视频自动封面 ----
  // 抽帧图与手选封面走同一条上传通道（同一套尺寸/格式校验与压缩），只是发起者不同。
  const coverIdRef = useRef(coverId);
  useEffect(() => {
    coverIdRef.current = coverId;
  });
  /** 上一次自动写入的封面 id：自动值之间可互相覆盖，用户手选过就不再抢 */
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
      // 换新视频时把上一张自动封面挤掉，别在封面槽里留两份
      setFiles((prev) => [item, ...prev.filter((f) => f.id !== stale)].slice(0, ARTICLE_MEDIA_MAX));
      setCoverId(item.id);
      setUploadMsg(null);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }, []);

  // 草稿状态条：模式屏与表单屏共用，分隔线/外框由调用处决定。
  // 自动保存开关不在这里（已移到账户设置·发布），这里只留「存到哪 / 现在什么状态 / 手动存一次」。
  const draftBar = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      <Link
        href="/settings?tab=publish"
        className="inline-flex items-center gap-1 text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
      >
        草稿箱{draftCount > 0 ? `（${draftCount}）` : ""}
      </Link>
      {type !== null && (
        <Button
          type="button"
          onClick={() => void persist(true)}
          className="inline-flex items-center gap-1.5 rounded-none border border-brand-300 bg-surface px-2.5 py-1 text-xs text-neutral-700 hover:border-brand-500"
        >
          <Save size={12} aria-hidden /> 保存草稿
        </Button>
      )}
      <span className={saveState === "error" ? "text-red-500" : "text-neutral-400"}>
        {saveState === "saving"
          ? "正在保存…"
          : saveState === "error"
            ? (saveMsg ?? "保存失败")
            : savedAt
              ? `已保存 ${draftTimeText(savedAt)}${saveMsg ? ` · ${saveMsg}` : ""}`
              : "开始填写后自动保存"}
      </span>
      <span className="text-neutral-400">
        {autoSave ? "Ctrl+S 立即保存" : "自动保存已在账户设置关闭 · Ctrl+S 立即保存"}
      </span>
    </div>
  );

  // 第一步：只选发布类型，表单与提交按钮都还没出现。
  // 画法对齐首页分类块：方块图标底 + 直角描边卡 + 像素分段条，hover 整块点亮。
  if (type === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">发布资源</h1>
        <p className="mt-2 text-sm text-neutral-500">
          选一种要发布的类型，再填对应信息；选好后也能在表单顶部随时切换。
        </p>

        <section className="mt-6 rounded-none border border-brand-200 bg-surface">
          <div className="border-b border-brand-100 px-4 py-3">
            <SectionTitle n={MODE_STEP}>选择发布类型</SectionTitle>
          </div>

          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {TYPES.map((t) => (
              <Button
                key={t.k}
                type="button"
                onClick={() => applyType(t.k)}
                className="group flex items-start gap-3 rounded-none border border-brand-200 bg-surface p-3 text-left transition hover:border-brand-500 hover:bg-brand-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-none border border-brand-600 bg-brand-500 text-white transition group-hover:bg-brand-600">
                  <t.Icon size={17} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-neutral-800">{t.label}</span>
                    <ChevronRight
                      size={13}
                      aria-hidden
                      className="shrink-0 text-brand-500 opacity-0 transition group-hover:opacity-100"
                    />
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] leading-4 text-neutral-400">
                    {t.desc}
                  </span>
                  <span className="mt-2 flex gap-[3px]" aria-hidden>
                    {Array.from({ length: 8 }, (_, i) => (
                      <span
                        key={i}
                        className="h-1.5 flex-1 bg-brand-100 transition-colors group-hover:bg-brand-400"
                      />
                    ))}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </section>

        <div className="mt-4 rounded-none border border-brand-200 bg-surface px-4 py-3">
          {draftBar}
        </div>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      // 附件还在上传就拦下这次提交：不能把半截清单写进库
      onSubmit={(e) => {
        if (attachBusy > 0) {
          e.preventDefault();
          setUploadMsg("附件正在上传，请等上传完成后再提交");
        }
      }}
      // 分节里的非受控输入不会进 React state，用表单级事件统一标记「改过了」触发自动保存
      onChange={() => setFormTick((t) => t + 1)}
      onInput={() => setFormTick((t) => t + 1)}
      className="mx-auto max-w-3xl px-4 py-10 sm:px-6"
    >
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">发布资源</h1>
      <p className="mt-2 rounded-none border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs leading-5 text-brand-800">
        免审用户直接上架，其他人等审核通过。
      </p>

      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="mediaIds" value={JSON.stringify(ids)} />
      <input type="hidden" name="coverId" value={coverId} />
      {/* 发布成功由服务端据此清掉草稿（见 createResourceAction） */}
      <input type="hidden" name="draftId" value={draftId ?? ""} />

      {/* 已选类型：小标签式切换，切换不会清空已填内容 */}
      <div className="mt-6 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <Button
            key={t.k}
            type="button"
            onClick={() => applyType(t.k)}
            aria-pressed={type === t.k}
            className={`inline-flex items-center gap-1.5 rounded-none border px-3 py-1.5 text-xs transition ${
              type === t.k
                ? "border-brand-600 bg-brand-500 text-white"
                : "border-brand-200 bg-surface text-neutral-500 hover:border-brand-400 hover:text-neutral-800"
            }`}
          >
            <t.Icon size={13} aria-hidden />
            {t.label}
          </Button>
        ))}
      </div>

      <section className="mt-6 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
        <SectionTitle n={STEP.BASIC}>基础信息</SectionTitle>
        <div>
          <label className={wizLabel} htmlFor="title">
            标题
          </label>
          <input
            id="title"
            name="title"
            required
            maxLength={80}
            defaultValue={d?.title ?? ""}
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
            defaultValue={d?.summary ?? ""}
            placeholder="卡片/详情页副标题"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel}>
            {type === "ARTICLE" ? "正文" : "详细描述"}
          </label>
          <MdEditor
            defaultValue={d?.description ?? ""}
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
            {/* 非受控：选中的值由浏览器持有，重渲染/重挂载都不会把它打回占位符 */}
            <select
              id="categoryId"
              name="categoryId"
              defaultValue={d?.categoryId ?? ""}
              className={`${wizInput} text-neutral-900 dark:text-neutral-100`}
            >
              <option value="" className="text-neutral-500 dark:text-neutral-400">
                选择分类…
              </option>
              {categories.map((c) => (
                <option
                  key={c.id}
                  value={c.id}
                  className="bg-surface text-neutral-900 dark:text-neutral-100"
                >
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
              defaultValue={d?.tags ?? ""}
              placeholder="空格或逗号分隔，如：像素风 开放世界"
              className={wizInput}
            />
          </div>
        </div>
      </section>

      {/* 按类型渲染对应分节 */}
      {type === "IMAGE" && (
        <ImageSection
          initial={{
            isAiGenerated: d?.isAiGenerated,
            original: d?.original,
            downloads: d ? downloadsInit(d) : undefined,
          }}
          fieldErrors={state.fieldErrors}
          limits={limits}
          onBusyChange={setAttachBusy}
        />
      )}
      {type === "ARTICLE" && (
        <ArticleSection
          initial={{ downloads: d ? downloadsInit(d) : undefined }}
          fieldErrors={state.fieldErrors}
          limits={limits}
          onBusyChange={setAttachBusy}
        />
      )}
      {type === "GAME" && (
        <GameSection
          downloads={
            d
              ? downloadsOf(d).map((r) => ({
                  name: r.name || r.url,
                  url: r.url,
                }))
              : undefined
          }
          fieldErrors={state.fieldErrors}
          limits={limits}
          onBusyChange={setAttachBusy}
        />
      )}
      {type === "MUSIC" && (
        <AvSection
          avKind="audio"
          initial={avInitial(d)}
          fieldErrors={state.fieldErrors}
          limits={limits}
          onBusyChange={setAttachBusy}
        />
      )}
      {type === "VIDEO" && (
        <AvSection
          avKind="video"
          initial={avInitial(d)}
          fieldErrors={state.fieldErrors}
          limits={limits}
          onBusyChange={setAttachBusy}
          onCoverFrame={onCoverFrame}
        />
      )}

      {/* 图片上传（游戏 / 文章 / 音乐 / 视频为单张封面，不使用预览图组） */}
      <MediaPicker
        files={files}
        coverId={coverId}
        uploading={uploading}
        isArticle={isArticle}
        singleCover={singleCover}
        maxMb={limits.galleryImageMaxMb}
        maxCount={mediaMax}
        uploadMsg={uploadMsg}
        progress={progress}
        fieldError={state.fieldErrors?.mediaIds}
        onPick={onFiles}
        onRemove={remove}
        onSetCover={setCoverId}
        fileRef={fileRef}
      />

      {/* 发布选项（与改稿页共用 PublishOptionGrid：标题独占一行，勾选项在下方网格里） */}
      <section className="mt-4 rounded-none border border-brand-200 bg-surface p-5">
        <SectionTitle n={STEP.OPTIONS}>发布选项</SectionTitle>
        <PublishOptionGrid checkedOf={(name) => name === "allowComments"} />
      </section>

      {/* 提交 */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          disabled={pending || uploading || attachBusy > 0}
          className="rounded-none border border-brand-600 bg-brand-500 px-8 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {pending
            ? "提交中…"
            : attachBusy > 0
              ? "等待附件上传…"
              : !singleCover && files.length === 0
                ? "先上传图片"
                : "提交发布"}
        </Button>
        {attachBusy > 0 && (
          <span className="text-sm text-amber-600">附件上传中，完成后才能提交</span>
        )}
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

      <div className="mt-5 border-t border-brand-100 pt-3">{draftBar}</div>
    </form>
  );
}

/** 草稿里的附件清单（IMAGE / ARTICLE 共用 downloads JSON） */
function downloadsInit(d: DraftPayload) {
  const rows = downloadsOf(d);
  return rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    url: r.url,
    size: r.size || undefined,
  }));
}

/** 音乐 / 视频分节的初始值 */
function avInitial(d: DraftPayload | null) {
  if (!d) return undefined;
  return {
    source: (d.avSource === "file" ? "file" : "mount") as "file" | "mount",
    mode: (d.avMode === "embed" ? "embed" : "direct") as "embed" | "direct",
    url: d.avUrl,
    duration: d.duration,
    artist: d.artist,
    resolution: d.resolution,
  };
}
