"use client";

// 后台「上传限制」编辑：附件单文件上限 + 允许后缀 + 四档图片单张上限（图集/评论图/头像/主页横幅）
// + 图片数量上限（图集张数无上界，评论图 0..20）+ 图片压缩（输出格式 webp/jpg/png 与质量，webp/png 保留 alpha）。
// 纯客户端表单，保存走 saveUploadLimitsAction；数值服务端 clamp、后缀 normalizeExts 权威校验，
// 前端只是组织入参并在服务端 refresh 后把最新配置同步回本地草稿（渲染期派生，见下方 prev 对比）。
import { useState } from "react";
import {
  Check,
  FileUp,
  Image as ImageIcon,
  MessageCircle,
  Minimize2,
  PanelTop,
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
  MB_PER_GB,
  MB_RANGE,
  QUALITY_RANGE,
  SIZE_UNITS,
  fromMb,
  sizeText,
  toMb,
  type ImageOutputFormat,
  type SizeUnit,
  type UploadLimits,
} from "@/lib/upload-config";
import { useAction } from "@/lib/hooks";
import { confirmDialog } from "@/components/ui/feedback";
import { resetUploadLimitsAction, saveUploadLimitsAction } from "@/lib/actions/uploads";
import { BTN_DANGER_SM, BTN_PRIMARY_SM, INPUT_SM, SELECT_SM } from "@/lib/ui/cls";
import { Button } from "@/components/ui/Button";

/** 图片类体积字段：档位只有 1–100MB，用 MB 输入即自然，不配单位选择 */
type ImageMbKey =
  | "galleryImageMaxMb"
  | "commentImageMaxMb"
  | "avatarMaxMb"
  | "heroImageMaxMb"
  | "profileBgMaxMb";
/** 概览卡覆盖的全部体积字段（含附件） */
type MbKey = "attachmentMaxMb" | ImageMbKey;

const IMAGE_MB_FIELDS: { key: ImageMbKey; label: string; hint: string }[] = [
  {
    key: "galleryImageMaxMb",
    label: "图集 / 原图单张（MB）",
    hint: "预览图、图包封面、详情原图，以及后台媒体库管理员直传共用此档。",
  },
  {
    key: "commentImageMaxMb",
    label: "评论附图单张（MB）",
    hint: "评论里附带图片（服务端会按下方压缩配置输出，此限在原图字节上判定）。",
  },
  {
    key: "avatarMaxMb",
    label: "头像（MB）",
    hint: "设置页上传头像的单张上限（裁剪产物通常远小于此）。",
  },
  {
    key: "heroImageMaxMb",
    label: "主页横幅（MB）",
    hint: "个人主页顶部 16:5 横幅（导出 1600×500）的单张上限。横幅比头像宽得多，建议单独放宽。",
  },
  {
    key: "profileBgMaxMb",
    label: "主页背景（MB）",
    hint: "个人主页铺满视口的底图，PC 与移动端各一张共用此档。只在用户达到等级门槛后可见。",
  },
];

const ATTACH_HINT =
  "zip/rar/PDF/音视频等站内附件。启用 OneDrive 时使用分片上传，上限可开到 250GB；其他存储驱动仍受各自限制。";

/** 图片数量限制字段：key / label / 范围（张）；**省略 max = 无上界**（图集张数已去掉 60 张天花板） */
const COUNT_FIELDS: {
  key: "galleryImageMaxCount" | "commentImageMaxCount";
  label: string;
  min: number;
  max?: number;
  hint: string;
}[] = [
  {
    key: "galleryImageMaxCount",
    label: "图集 / 原图 张数上限",
    min: COUNT_RANGE.min,
    hint: "单个【图片】资源可上传的预览图张数（含首图）。超出后上传入口禁用。已去掉 60 张上限，按实际批量填写（站内限流 120 次/小时/账号）。",
  },
  {
    key: "commentImageMaxCount",
    label: "评论附图 张数上限",
    min: COMMENT_COUNT_RANGE.min,
    max: COMMENT_COUNT_RANGE.max,
    hint: "单条评论可附带的图片张数。设为 0 即禁止评论附图。",
  },
];

const OVERVIEW_FIELDS: { key: MbKey; label: string; note: string; Icon: typeof FileUp }[] = [
  { key: "attachmentMaxMb", label: "附件", note: "单文件上限", Icon: FileUp },
  { key: "galleryImageMaxMb", label: "图集 / 原图", note: "单张上限", Icon: ImageIcon },
  { key: "commentImageMaxMb", label: "评论附图", note: "单张上限", Icon: MessageCircle },
  { key: "avatarMaxMb", label: "头像", note: "单张上限", Icon: UserRound },
  { key: "heroImageMaxMb", label: "主页横幅", note: "单张上限", Icon: PanelTop },
  { key: "profileBgMaxMb", label: "主页背景", note: "单张上限", Icon: ImageIcon },
];

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

type Draft = {
  /** 附件上限的输入值；单位单独存，避免"以 GB 思维填 MB 数字" */
  attachmentSize: string;
  attachmentUnit: SizeUnit;
  attachmentExts: string;
  galleryImageMaxMb: string;
  commentImageMaxMb: string;
  avatarMaxMb: string;
  heroImageMaxMb: string;
  profileBgMaxMb: string;
  galleryImageMaxCount: string;
  commentImageMaxCount: string;
  imageFormat: ImageOutputFormat;
  imageQuality: string;
};

const toDraft = (l: UploadLimits): Draft => {
  const attach = fromMb(l.attachmentMaxMb);
  return {
    attachmentSize: String(attach.value),
    attachmentUnit: attach.unit,
    attachmentExts: l.attachmentExts.join(" "),
    galleryImageMaxMb: String(l.galleryImageMaxMb),
    commentImageMaxMb: String(l.commentImageMaxMb),
    avatarMaxMb: String(l.avatarMaxMb),
    heroImageMaxMb: String(l.heroImageMaxMb),
    profileBgMaxMb: String(l.profileBgMaxMb),
    galleryImageMaxCount: String(l.galleryImageMaxCount),
    commentImageMaxCount: String(l.commentImageMaxCount),
    imageFormat: l.imageFormat,
    imageQuality: String(l.imageQuality),
  };
};

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

  // 附件上限：输入值 + 单位 → 整数 MB。存储口径始终是 MB，单位只影响输入与展示。
  const attachRaw = draft.attachmentSize.trim();
  const attachNum = attachRaw === "" ? NaN : Number(attachRaw);
  const attachMb = toMb(attachNum, draft.attachmentUnit);
  const attachBad =
    attachRaw === "" ||
    !Number.isFinite(attachNum) ||
    attachMb < MB_RANGE.attachment.min ||
    attachMb > MB_RANGE.attachment.max
      ? `请输入 ${sizeText(MB_RANGE.attachment.min)} – ${sizeText(MB_RANGE.attachment.max)} 之间的上限`
      : null;

  /** 概览卡的取值：附件走折算后的 MB，图片档直接读草稿 */
  const draftMb = (key: MbKey): number =>
    key === "attachmentMaxMb" ? attachMb : Number(draft[key]);

  /** 输入框的 min/max/step 随单位走；真正的合法性判定统一用折算后的 MB */
  const attachBounds =
    draft.attachmentUnit === "GB"
      ? { min: 1, max: MB_RANGE.attachment.max / MB_PER_GB, step: 0.5 }
      : { min: MB_RANGE.attachment.min, max: MB_RANGE.attachment.max, step: 1 };

  /**
   * 切换单位时把数值一起折算过去 —— 否则「200」从 MB 切到 GB 会被重新解读成 200GB。
   * 非法输入只换单位不折算（不做无意义的换算，也不假装它是合法的）。
   */
  function changeUnit(unit: SizeUnit) {
    setDraft((d) => {
      if (attachBad) return { ...d, attachmentUnit: unit };
      const mb = toMb(Number(d.attachmentSize), d.attachmentUnit);
      return {
        ...d,
        attachmentUnit: unit,
        // 4 位小数足够无损往返：误差 ≤ 0.00005GB = 0.0512MB，round 后必然回到同一个 MB
        attachmentSize: unit === "GB" ? String(Number((mb / MB_PER_GB).toFixed(4))) : String(mb),
      };
    });
  }

  function save() {
    void run(() =>
      saveUploadLimitsAction({
        attachmentMaxMb: attachMb,
        attachmentExts: draft.attachmentExts,
        galleryImageMaxMb: Number(draft.galleryImageMaxMb),
        commentImageMaxMb: Number(draft.commentImageMaxMb),
        avatarMaxMb: Number(draft.avatarMaxMb),
        heroImageMaxMb: Number(draft.heroImageMaxMb),
        profileBgMaxMb: Number(draft.profileBgMaxMb),
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
        "将附件与图片上传限制恢复为站点默认值（附件 200MB + 内置后缀；图集/原图 20MB、评论附图 5MB、头像 5MB、主页横幅 20MB、主页背景 20MB），图片压缩恢复为 webp + 质量 82，确定？",
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
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
                {sizeText(draftMb(key))}
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
                  控制图集、评论附图、头像、主页横幅与主页背景的单张原图大小，服务端会在上传时统一校验。
                </p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-brand-100">
            {IMAGE_MB_FIELDS.map((f) => (
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
                      {MB_RANGE.image.min}–{MB_RANGE.image.max} MB
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-neutral-400">{f.hint}</p>
                </div>
                <input
                  id={`ul-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={MB_RANGE.image.min}
                  max={MB_RANGE.image.max}
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
                      {f.max === undefined ? `≥ ${f.min} 张` : `${f.min}–${f.max} 张`}
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
                <label className="text-xs font-medium text-neutral-700" htmlFor="ul-attachmentSize">
                  附件单文件上限
                </label>
                <span className="text-[10px] text-neutral-400">
                  {sizeText(MB_RANGE.attachment.min)}–{sizeText(MB_RANGE.attachment.max)}
                </span>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  id="ul-attachmentSize"
                  type="number"
                  inputMode="decimal"
                  step={attachBounds.step}
                  min={attachBounds.min}
                  max={attachBounds.max}
                  value={draft.attachmentSize}
                  onChange={(e) => set("attachmentSize", e.target.value)}
                  aria-describedby="ul-attachmentSize-hint"
                  className={`${INPUT_SM} min-w-0 flex-1 text-right tabular-nums sm:text-left`}
                />
                <select
                  aria-label="附件上限单位"
                  value={draft.attachmentUnit}
                  onChange={(e) => changeUnit(e.target.value as SizeUnit)}
                  className={`${SELECT_SM} shrink-0`}
                >
                  {SIZE_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              {attachBad ? (
                <p id="ul-attachmentSize-hint" className="mt-1 text-[11px] leading-4 text-red-600">
                  {attachBad}
                </p>
              ) : (
                <p
                  id="ul-attachmentSize-hint"
                  className="mt-1 text-[11px] leading-4 text-neutral-400"
                >
                  {ATTACH_HINT}
                  {draft.attachmentUnit === "GB" && (
                    <span className="ml-1 tabular-nums text-neutral-500">当前 = {attachMb}MB</span>
                  )}
                </p>
              )}
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
          disabled={pending || !!attachBad}
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
