"use client";

// 后台「上传限制」编辑：附件单文件上限 + 允许后缀 + 三档图片单张上限（图集/评论图/头像）。
// 纯客户端表单，保存走 saveUploadLimitsAction；数值服务端 clamp、后缀 normalizeExts 权威校验，
// 前端只是组织入参并在服务端 refresh 后把最新配置同步回本地草稿（渲染期派生，见下方 prev 对比）。
import { useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { DEFAULT_ATTACH_EXTS, type UploadLimits } from "@/lib/upload-config";
import { useAction } from "@/lib/hooks";
import { resetUploadLimitsAction, saveUploadLimitsAction } from "@/lib/actions/uploads";
import { BTN_DANGER_SM, BTN_PRIMARY_SM, INPUT_SM, LABEL_STRONG } from "@/lib/ui/cls";
import MiniBadge from "@/components/ui/MiniBadge";

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
    max: 250,
    hint: "zip/rar/PDF/音视频等站内附件。250 为 OneDrive Graph 单请求硬顶，即使未开云盘也全局一致。",
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
    hint: "评论里附带图片（服务端会压缩为 webp，此限在原图字节上判定）。",
  },
  {
    key: "avatarMaxMb",
    label: "头像（MB）",
    min: 1,
    max: 100,
    hint: "设置页上传头像的单张上限（裁剪产物通常远小于此）。",
  },
];

type Draft = {
  attachmentMaxMb: string;
  attachmentExts: string;
  galleryImageMaxMb: string;
  commentImageMaxMb: string;
  avatarMaxMb: string;
};

const toDraft = (l: UploadLimits): Draft => ({
  attachmentMaxMb: String(l.attachmentMaxMb),
  attachmentExts: l.attachmentExts.join(" "),
  galleryImageMaxMb: String(l.galleryImageMaxMb),
  commentImageMaxMb: String(l.commentImageMaxMb),
  avatarMaxMb: String(l.avatarMaxMb),
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

  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  function save() {
    void run(() =>
      saveUploadLimitsAction({
        attachmentMaxMb: Number(draft.attachmentMaxMb),
        attachmentExts: draft.attachmentExts,
        galleryImageMaxMb: Number(draft.galleryImageMaxMb),
        commentImageMaxMb: Number(draft.commentImageMaxMb),
        avatarMaxMb: Number(draft.avatarMaxMb),
      }),
    );
  }

  function reset() {
    if (
      !window.confirm(
        "将附件与图片上传限制恢复为站点默认值（200MB + 内置后缀 / 20 / 5 / 5），确定？",
      )
    )
      return;
    void run(() => resetUploadLimitsAction());
  }

  // 文本区实时预览：多少项、样例、（客户端不去逐字校验，服务端 save 时兜底）
  const extTokens = draft.attachmentExts
    .split(/[\s,，;、]+/)
    .map((t) => t.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-none border border-brand-200 bg-surface">
        <div className="border-b border-brand-100 bg-brand-50/50 px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-neutral-900">附件与图片上传限制</h2>
            <MiniBadge strong>后台配置</MiniBadge>
          </div>
          <p className="mt-2 max-w-4xl text-xs leading-5 text-neutral-500">
            所有上传入口（发布向导、追加版本、评论区、头像、媒体库直传）以这里的值为准，改动即生效，
            无需重启。图片<b>允许格式</b>由服务端字节嗅探决定（png/jpg/webp/gif/avif
            等），不在此配置。 危险后缀（可执行/脚本型文件）已全局禁用，即使添加也会被拒。
          </p>
        </div>

        {/* 数值档位 */}
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:gap-4 sm:p-5">
          {NUM_FIELDS.map((f) => (
            <div key={f.key} className="min-w-0 border border-brand-100 bg-brand-50/30 p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <label className={LABEL_STRONG} htmlFor={`ul-${f.key}`}>
                  {f.label}
                </label>
                <span className="shrink-0 rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-400">
                  {f.min}–{f.max} MB
                </span>
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
                className={`${INPUT_SM} mt-1 w-full max-w-none sm:max-w-40`}
              />
              <p className="mt-1 text-[11px] leading-4 text-neutral-400">{f.hint}</p>
            </div>
          ))}
        </div>

        {/* 附件后缀 */}
        <div className="border-t border-brand-100 px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <label className={LABEL_STRONG} htmlFor="ul-attachmentExts">
              附件允许后缀（每行 / 空格 / 逗号分隔一项）
            </label>
            <span className="shrink-0 text-[11px] text-neutral-400">
              小写、不带点 · 已识别 {extTokens.length} 项
            </span>
          </div>
          <textarea
            id="ul-attachmentExts"
            rows={6}
            spellCheck={false}
            value={draft.attachmentExts}
            onChange={(e) => set("attachmentExts", e.target.value)}
            className="mt-1 w-full rounded-none border border-brand-200 bg-surface px-2.5 py-1.5 font-mono text-xs leading-5 outline-none transition focus:border-brand-500"
            placeholder={DEFAULT_ATTACH_EXTS.join(" ")}
          />
          <div className="mt-2 grid gap-1.5 text-[11px] leading-4 text-neutral-400 sm:grid-cols-[auto_1fr] sm:gap-x-4">
            <span className="min-w-0">
              默认 {DEFAULT_ATTACH_EXTS.length} 项：
              <span className="font-mono text-neutral-500">{DEFAULT_ATTACH_EXTS.join("/")}</span>
            </span>
            <span className="min-w-0 text-red-500/80">
              危险后缀（html/svg/js/exe/msi 等脚本可执行型）硬拒，防存储型 XSS / 下载执行。
            </span>
          </div>
        </div>
      </section>

      {/* 操作栏 */}
      <div className="flex flex-wrap items-center gap-2.5 border-t border-brand-100 pt-4 sm:gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className={`${BTN_PRIMARY_SM} min-h-9 px-4`}
        >
          <Save size={13} aria-hidden /> 保存
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={reset}
          className={`${BTN_DANGER_SM} min-h-9 px-4`}
        >
          <RotateCcw size={13} aria-hidden /> 恢复默认
        </button>
        <span className="basis-full text-xs leading-5 text-neutral-400 sm:basis-auto">
          保存后上传向导 / 版本 / 头像等入口的提示与校验同步更新。
        </span>
      </div>
    </div>
  );
}
