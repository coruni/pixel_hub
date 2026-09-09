"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import HeroCropper from "./HeroCropper";
import { removeHeroAction, uploadHeroAction, type SettingsActionState } from "@/lib/actions/settings";
import { publicUrl } from "@/lib/storage/url";
import { Button } from "@/components/ui/Button";

// 主页横幅：选图 → 16:5 裁剪 → 预览 → 保存。
// 与 AvatarForm 同款交互：原始文件进裁剪器，裁剪产物经 DataTransfer 注入隐藏提交 input。
export default function HeroForm({
  heroImageKey,
  heroMaxMb = 20,
}: {
  heroImageKey: string | null;
  heroMaxMb?: number;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    uploadHeroAction,
    {},
  );
  const [file, setFile] = useState<File | null>(null);
  const [cropped, setCropped] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  const currentPreview = preview ?? (heroImageKey ? publicUrl(heroImageKey) : null);

  function pick(f: File | null | undefined) {
    if (!f) return;
    setCropped(null);
    setPreview(null);
    setFile(f);
  }

  function onConfirm(blob: Blob) {
    const f = new File([blob], "hero.webp", { type: blob.type || "image/webp" });
    const dt = new DataTransfer();
    dt.items.add(f);
    if (hiddenRef.current) hiddenRef.current.files = dt.files;
    setFile(null);
    setCropped(f);
    setPreview(URL.createObjectURL(f));
  }

  useEffect(() => {
    if (cropped && hiddenRef.current && !hiddenRef.current.files?.length) {
      const dt = new DataTransfer();
      dt.items.add(cropped);
      hiddenRef.current.files = dt.files;
    }
  }, [cropped]);

  return (
    <div className="space-y-3">
      <div
        className="relative aspect-[16/5] w-full overflow-hidden rounded-none border border-brand-200 bg-brand-50"
        style={
          currentPreview
            ? {
                backgroundImage: `url(${currentPreview})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {!currentPreview && (
          <div className="grid h-full place-items-center text-xs text-neutral-400">
            暂未设置主页横幅
          </div>
        )}
      </div>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input ref={hiddenRef} type="file" name="hero" className="hidden" disabled={!cropped} />
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-none border border-brand-600 bg-brand-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          <Upload size={14} aria-hidden /> {heroImageKey ? "更换横幅" : "上传横幅"}
        </Button>
        <Button
          type="submit"
          disabled={pending || !cropped}
          className="rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-700 hover:border-brand-500 disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存"}
        </Button>
        {heroImageKey && (
          <Button
            type="submit"
            formAction={removeHeroAction}
            className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-600 hover:border-red-300 hover:text-red-600"
          >
            <Trash2 size={14} aria-hidden /> 移除
          </Button>
        )}
        {state.ok && <span className="text-sm text-emerald-600">✓ 已更新</span>}
        {state.error && <span className="text-sm text-red-500">{state.error}</span>}
        {cropped && (
          <span className="text-xs text-neutral-400">已裁剪 1600×500，点「保存」上传</span>
        )}
      </form>
      <p className="text-xs leading-5 text-neutral-400">
        比例 16:5（导出 1600×500 webp），建议尺寸 ≥ 1600×500，最大 {heroMaxMb}MB。
        横幅仅在你的公开主页展示，未设置则头部按原版显示。
      </p>

      {file && <HeroCropper file={file} onCancel={() => setFile(null)} onConfirm={onConfirm} />}
    </div>
  );
}