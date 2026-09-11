"use client";

// 后台「上传限制」编辑：附件单文件上限 + 允许后缀 + 三档图片单张上限（图集/评论图/头像）
// + 图片压缩（输出格式 webp/jpg/png 与质量，webp/png 保留 alpha）。
// 纯客户端表单，保存走 saveUploadLimitsAction；数值服务端 clamp、后缀 normalizeExts 权威校验，
// 前端只是组织入参并在服务端 refresh 后把最新配置同步回本地草稿（渲染期派生，见下方 prev 对比）。
import { useState } from "react";
import {
  Check,
  FileUp,
  Image as ImageIcon,
  MessageCircle,
  Minimize2,
  RotateCcw,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  COMMENT_COUNT_RANGE,
  COUNT_RANGE,
  DEFAULT_ATTACH_EXTS,
  DEFAULT_IMAGE_FORMAT,
  DEFAULT_IMAGE_QUALITY,
  MB_RANGE,
  QUALITY_RANGE,
  type ImageOutputFormat,
  type UploadLimits,
} from "@/lib/upload-config";
import { useAction } from "@/lib/hooks";
import { confirmDialog } from "@/components/ui/feedback";
import { resetUploadLimitsAction, saveUploadLimitsAction } from "@/lib/actions/uploads";
import { BTN_DANGER_SM, BTN_PRIMARY_SM, INPUT_SM } from "@/lib/ui/cls";
import { Button } from "@/components/ui/Button";

/** 数值字段规约：key / label / 范围（提交时服务端还会 clamp，这里仅辅助输入） */
const NUM_FIELDS: {
  key: "attachmentMaxMb" | "galleryImageMaxMb" | "commentImageMaxMb" | "avatarMaxMb";
  label: string;
  min: number;
  max: number;
  hint: string;
}[] = [
  {
    key: "attachmentMaxMb",
    label: "附件单文件上限（MB）",
    min: 1,
    max: MB_RANGE.attachment.max,
    hint: "zip/rar/PDF/音视频等站内附件。启用 OneDrive 时使用分片上传，最大支持 250GB；其他存储仍受自身限制。",
  },
  {
    key: "galleryImageMaxMb",
    label: "图集 / 原图单张（MB）",
    min: 1,
    max: 100,
    hint: "预览图、图包封面、详情原图，以及后台媒体库管理员直传共用此档。",
  },
  {
    key: "commentImageMaxMb",
    label: "评论附图单张（MB）",
    min: 1,
    max: 100,
    hint: "评论里附带图片（服务端会按下方压缩配置输出，此限在原图字节上判定）。",
  },
  {
    key: "avatarMaxMb",
    label: "头像（MB）",
    min: 1,
    max: 100,
    hint: "设置页上传头像的单张上限（裁剪产物通常远小于此）。",
  },
];

/** 图片数量限制字段：key / label / 范围（张） */
const COUNT_FIELDS: {
  key: "galleryImageMaxCount" | "commentImageMaxCount";
  label: string;
  min: number;
  max: number;
  hint: string;
}[] = [
  {
    key: "galleryImageMaxCount",
    label: "图集 / 原图 张数上限",
    min: COUNT_RANGE.min,
    max: COUNT_RANGE.max,
    hint: "单个【图片】资源可上传的预览图张数（含首图）。超出后上传入口禁用。",
  },
  {
    key: "commentImageMaxCount",
    label: "评论附图 张数上限",
    min: COMMENT_COUNT_RANGE.min,
    max: COMMENT_COUNT_RANGE.max,
    hint: "单条评论可附带的图片张数。设为 0 即禁止评论附图。",
  },
];

const OVERVIEW_FIELDS = [
  { key: "attachmentMaxMb", label: "附件", note: "单文件上限", Icon: FileUp },
  { key: "galleryImageMaxMb", label: "图集 / 原图", note: "单张上限", Icon: ImageIcon },
  { key: "commentImageMaxMb", label: "评论附图", note: "单张上限", Icon: MessageCircle },
  { key: "avatarMaxMb", label: "头像", note: "单张上限", Icon: UserRound },
] as const;

const IMAGE_FIELDS = NUM_FIELDS.filter((field) => field.key !== "attachmentMaxMb");

/** 压缩输出格式选项：value / 展示名 / 一句话说明（透明通道差异必须写明，避免选错格式丢透明） */
const FORMAT_OPTIONS: { value: ImageOutputFormat; label: string; note: string }[] = [
  { value: "webp", label: "WEBP", note: "体积最小 · 保留透明" },
  { value: "jpg", label: "JPG", note: "兼容最好 · 无透明" },
  { value: "png", label: "PNG", note: "无损优先 · 保留透明" },
];

const FORMAT_QUALITY_HINT: Record<ImageOutputFormat, string> = {
  webp: "webp 有损档位，体积与画质平衡最好，推荐 75–90。透明通道独立无损保留。",
  jpg: "jpg 有损档位，推荐 75–90。格式本身无透明通道，透明区域会合成白底。",
  png: "png 走调色板量化，推荐 70–90；设为 100 时改为无损压缩（体积最大）。透明通道保留。",
};

const limitText = (mb: number) => {
  if (!Number.isFinite(mb)) return "—";
  return mb >= 1024 ? `${mb / 1024}GB` : `${mb}MB`;
};

type Draft = {
  attachmentMaxMb: string;
  attachmentExts: string;
  galleryImageMaxMb: string;
  commentImageMaxMb: string;
  avatarMaxMb: string;
  galleryImageMaxCount: string;
  commentImageMaxCount: string;
  imageFormat: ImageOutputFormat;
  imageQuality: string;
};

const toDraft = (l: UploadLimits): Draft => ({
  attachmentMaxMb: String(l.attachmentMaxMb),
  attachmentExts: l.attachmentExts.join(" "),
  galleryImageMaxMb: String(l.galleryImageMaxMb),
  commentImageMaxMb: String(l.commentImageMaxMb),
  avatarMaxMb: String(l.avatarMaxMb),
  galleryImageMaxCount: String(l.galleryImageMaxCount),
  commentImageMaxCount: String(l.commentImageMaxCount),
  imageFormat: l.imageFormat,
  imageQuality: String(l.imageQuality),
});

export default function UploadLimitsManager({ limits }: { limits: UploadLimits }) {
  const { run, pending } = useAction();
  const [draft, setDraft] = useState<Draft>(() => toDraft(limits));
  const [prev, setPrev] = useState(limits);

  // 服务端 refresh 后 props 更新 → 把最新配置拉回草稿（渲染期派生 state，无 effect）
  if (prev !== limits) {
    setPrev(limits);
    setDraft(toDraft(limits));
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  function save() {
    void run(() =>
      saveUploadLimitsAction({
        attachmentMaxMb: Number(draft.attachmentMaxMb),
        attachmentExts: draft.attachmentExts,
        galleryImageMaxMb: Number(draft.galleryImageMaxMb),
        commentImageMaxMb: Number(draft.commentImageMaxMb),
        avatarMaxMb: Number(draft.avatarMaxMb),
        galleryImageMaxCount: Number(draft.galleryImageMaxCount),
        commentImageMaxCount: Number(draft.commentImageMaxCount),
        imageFormat: draft.imageFormat,
        imageQuality: Number(draft.imageQuality),
      }),
    );
  }

  function reset() {
    void confirmDialog({
      title: "恢复默认上传限制",
      message:
        "将附件与图片上传限制恢复为站点默认值（200MB + 内置后缀 / 20 / 5 / 5），图片压缩恢复为 webp + 质量 82，确定？",
      confirmLabel: "恢复默认",
      danger: true,
    }).then((ok) => {
      if (ok) run(() => resetUploadLimitsAction());
    });
  }

  // 解析输入的后缀 token（空格/逗号分隔；客户端不逐字校验，服务端 save 时兜底）
  const extTokens = draft.attachmentExts
    .split(/[\s,，;、]+/)
    .map((t) => t.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {OVERVIEW_FIELDS.map(({ key, label, note, Icon }) => (
          <div
            key={key}
            className="flex min-w-0 items-center gap-3 border border-brand-200 bg-surface px-3.5 py-3"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand-50 text-brand-600">
              <Icon size={17} strokeWidth={1.8} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs text-neutral-500">{label}</p>
              <p className="mt-0.5 text-base font-semibold tabular-nums text-neutral-900">
                {limitText(Number(draft[key]))}
              </p>
              <p className="text-[10px] text-neutral-400">{note}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <section className="overflow-hidden border border-brand-200 bg-surface xl:col-start-1 xl:row-start-1">
          <div className="border-b border-brand-100 px-4 py-4 sm:px-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand-50 text-brand-600">
                <ImageIcon size={18} strokeWidth={1.8} aria-hidden />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">图片上传限制</h2>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  控制图集、评论附图和头像的单张原图大小，服务端会在上传时统一校验。
                </p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-brand-100">
            {IMAGE_FIELDS.map((f) => (
              <div
                key={f.key}
                className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-start sm:px-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <label className="text-xs font-medium text-neutral-700" htmlFor={`ul-${f.key}`}>
                      {f.label}
                    </label>
                    <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400">
                      {f.min}–{f.max} MB
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-neutral-400">{f.hint}</p>
                </div>
                <input
                  id={`ul-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={f.min}
                  max={f.max}
                  step={1}
                  value={draft[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className={`${INPUT_SM} w-full text-right tabular-nums sm:text-left`}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden border border-brand-200 bg-surface xl:col-span-2">
          <div className="border-b border-brand-100 px-4 py-4 sm:px-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand-50 text-brand-600">
                <ImageIcon size={18} strokeWidth={1.8} aria-hidden />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">图片数量限制</h2>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  分别管控图集、文章插图与评论附图的张数上限，服务端在上传与发布时统一校验。
                </p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-brand-100">
            {COUNT_FIELDS.map((f) => (
              <div
                key={f.key}
                className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-start sm:px-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <label className="text-xs font-medium text-neutral-700" htmlFor={`ul-${f.key}`}>
                      {f.label}
                    </label>
                    <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400">
                      {f.min}–{f.max} 张
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-neutral-400">{f.hint}</p>
                </div>
                <input
                  id={`ul-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={f.min}
                  max={f.max}
                  step={1}
                  value={draft[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className={`${INPUT_SM} w-full text-right tabular-nums sm:text-left`}
                />
              </div>
            ))}
          </div>
        </section>
        <section className="overflow-hidden border border-brand-200 bg-surface xl:col-start-2 xl:row-start-1">
          <div className="border-b border-brand-100 px-4 py-4 sm:px-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand-50 text-brand-600">
                <FileUp size={18} strokeWidth={1.8} aria-hidden />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">附件格式限制</h2>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  附件支持的容量与后缀，应用到发布、版本追加和云盘上传。
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-5 p-4 sm:p-5">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  className="text-xs font-medium text-neutral-700"
                  htmlFor="ul-attachmentMaxMb"
                >
                  附件单文件上限（MB）
                </label>
                <span className="text-[10px] text-neutral-400">1MB–250GB</span>
              </div>
              <input
                id="ul-attachmentMaxMb"
                type="number"
                inputMode="numeric"
                min={1}
                max={MB_RANGE.attachment.max}
                step={1}
                value={draft.attachmentMaxMb}
                onChange={(e) => set("attachmentMaxMb", e.target.value)}
                className={`${INPUT_SM} mt-2 w-full text-right tabular-nums sm:text-left`}
              />
              <p className="mt-1 text-[11px] leading-4 text-neutral-400">{NUM_FIELDS[0].hint}</p>
            </div>

            <div className="border-t border-brand-100 pt-5">
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                <label className="text-xs font-medium text-neutral-700" htmlFor="ul-attachmentExts">
                  允许的附件后缀
                </label>
                <span className="text-[11px] text-neutral-400">
                  已识别 {extTokens.length} 项 · 空格或逗号分隔
                </span>
              </div>
              <textarea
                id="ul-attachmentExts"
                rows={7}
                spellCheck={false}
                value={draft.attachmentExts}
                onChange={(e) => set("attachmentExts", e.target.value)}
                className="mt-2 w-full resize-y rounded-none border border-brand-200 bg-surface px-2.5 py-2 font-mono text-xs leading-5 outline-none transition focus:border-brand-500"
                placeholder={DEFAULT_ATTACH_EXTS.join(" ")}
              />
              <p className="mt-2 break-words text-[11px] leading-4 text-neutral-400">
                默认 {DEFAULT_ATTACH_EXTS.length} 项：
                <span className="font-mono text-neutral-500">{DEFAULT_ATTACH_EXTS.join("/")}</span>
              </p>
            </div>

            <div className="flex gap-2 border border-red-200 bg-red-50/60 p-3 text-[11px] leading-4 text-red-600/90">
              <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                危险后缀（html/svg/js/exe/msi 等脚本可执行型）硬拒，防存储型 XSS / 下载执行。
              </span>
            </div>
          </div>
        </section>

        <section className="overflow-hidden border border-brand-200 bg-surface xl:col-span-2">
          <div className="border-b border-brand-100 px-4 py-4 sm:px-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand-50 text-brand-600">
                <Minimize2 size={18} strokeWidth={1.8} aria-hidden />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">图片压缩</h2>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  图集大图与缩略图、评论附图、头像、主页横幅统一按此输出；原图始终逐字节完整保留，
                  不受影响。webp 与 png 压缩时保留 alpha 透明通道，jpg 格式自身无透明通道。
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-2">
            <fieldset className="min-w-0">
              <legend className="text-xs font-medium text-neutral-700">输出格式</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {FORMAT_OPTIONS.map((o) => {
                  const selected = draft.imageFormat === o.value;
                  return (
                    <label key={o.value} className="relative block cursor-pointer">
                      <input
                        type="radio"
                        name="ul-imageFormat"
                        value={o.value}
                        checked={selected}
                        onChange={() => set("imageFormat", o.value)}
                        className="peer sr-only"
                      />
                      <span className="flex min-h-11 flex-col justify-center gap-0.5 border border-brand-200 bg-surface px-3 py-2 transition peer-hover:border-brand-400 peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400">
                        <span className="text-xs font-semibold text-neutral-900">{o.label}</span>
                        <span className="text-[11px] leading-4 text-neutral-500">{o.note}</span>
                      </span>
                      {selected && (
                        <Check
                          size={14}
                          className="pointer-events-none absolute right-2 top-2 text-brand-600"
                          aria-hidden
                        />
                      )}
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-neutral-400">
                当前：{FORMAT_OPTIONS.find((o) => o.value === draft.imageFormat)?.label ?? "—"} ·
                默认 {DEFAULT_IMAGE_FORMAT.toUpperCase()}（体积最优且保留透明）
              </p>
            </fieldset>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <label className="text-xs font-medium text-neutral-700" htmlFor="ul-imageQuality">
                  压缩质量
                </label>
                <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400">
                  {QUALITY_RANGE.min}–{QUALITY_RANGE.max}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-neutral-400">
                {FORMAT_QUALITY_HINT[draft.imageFormat]}
              </p>
              <input
                id="ul-imageQuality"
                type="number"
                inputMode="numeric"
                min={QUALITY_RANGE.min}
                max={QUALITY_RANGE.max}
                step={1}
                value={draft.imageQuality}
                onChange={(e) => set("imageQuality", e.target.value)}
                className={`${INPUT_SM} mt-2 w-full text-right tabular-nums sm:text-left`}
              />
              <p className="mt-1 text-[11px] leading-4 text-neutral-400">
                默认 {DEFAULT_IMAGE_QUALITY}；缩略图自动降一档（默认 {DEFAULT_IMAGE_QUALITY} →{" "}
                {DEFAULT_IMAGE_QUALITY - 8}）以控制体积。
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-brand-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={save}
          className={`${BTN_PRIMARY_SM} min-h-10 w-full justify-center px-4 sm:w-auto`}
        >
          {pending ? "保存中…" : (<><Save size={13} aria-hidden /> 保存</>)}
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={reset}
          className={`${BTN_DANGER_SM} min-h-10 w-full justify-center px-4 sm:w-auto`}
        >
          {pending ? "恢复中…" : (<><RotateCcw size={13} aria-hidden /> 恢复默认</>)}
        </Button>
        <span className="text-xs leading-5 text-neutral-400 sm:ml-1">
          保存后上传向导 / 版本 / 头像等入口的提示与校验同步更新，压缩配置对之后的上传生效。
        </span>
      </div>
    </div>
  );
}
