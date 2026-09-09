"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import AvatarCropper from "./AvatarCropper";
import {
  uploadAvatarAction,
  removeAvatarAction,
  type SettingsActionState,
} from "@/lib/actions/settings";
import { Button } from "@/components/ui/Button";

// 头像卡：选图 → 裁剪 256×256 → 预览 → 保存。
// GIF 免裁剪直传（仅受信用户）；blob: 预览 URL 原样放行，避免拼成 /uploads/blob:... 404。
export default function AvatarForm({
  name,
  username,
  avatarKey,
  trusted,
  avatarMaxMb = 5,
}: {
  name: string | null;
  username: string;
  avatarKey: string | null;
  trusted: boolean;
  avatarMaxMb?: number;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    uploadAvatarAction,
    {},
  );
  const [file, setFile] = useState<File | null>(null); // 原始选中的文件（进裁剪器）
  const [cropped, setCropped] = useState<File | null>(null); // 待上传文件（裁剪产物或免裁剪的 GIF）
  const [preview, setPreview] = useState<string | null>(null);
  const [gifDenied, setGifDenied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null); // 选图入口（不提交）
  const hiddenRef = useRef<HTMLInputElement>(null); // 真正提交 name="avatar" 的隐藏 input

  function pick(f: File | null | undefined) {
    if (!f) return;
    setCropped(null);
    setPreview(null);
    if (f.type === "image/gif") {
      // GIF 免裁剪直接上传，仅受信用户允许
      if (!trusted) {
        setGifDenied(true);
        setFile(null);
        return;
      }
      setGifDenied(false);
      setFile(null);
      setCropped(f);
      setPreview(URL.createObjectURL(f));
      return;
    }
    setGifDenied(false);
    setFile(f);
  }

  function onConfirm(blob: Blob) {
    const f = new File([blob], "avatar.webp", { type: blob.type || "image/webp" });
    // file input 不能靠 value 赋值，用 DataTransfer 塞进隐藏提交项
    const dt = new DataTransfer();
    dt.items.add(f);
    if (hiddenRef.current) hiddenRef.current.files = dt.files;
    setFile(null);
    setCropped(f);
    setPreview(URL.createObjectURL(f));
  }

  // GIF 原文件直接作为提交文件
  useEffect(() => {
    if (cropped?.type === "image/gif" && hiddenRef.current) {
      const dt = new DataTransfer();
      dt.items.add(cropped);
      hiddenRef.current.files = dt.files;
    }
  }, [cropped]);

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Avatar name={name} username={username} avatarKey={preview ?? avatarKey} size="lg" />
      <form action={formAction} className="min-w-0 flex-1">
        <p className="text-xs leading-5 text-neutral-400">
          支持 png / jpg / webp，最大 {avatarMaxMb}MB，选图后拖动或缩放调整
          {trusted && "；GIF 动图免裁剪直接上传"}
        </p>
        {state.ok && <p className="mt-1 text-sm text-emerald-600">✓ 已更新</p>}
        {state.error && <p className="mt-1 text-sm text-red-500">{state.error}</p>}
        {gifDenied && <p className="mt-1 text-sm text-red-500">GIF 头像仅对受信用户开放</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={
              trusted
                ? "image/png,image/jpeg,image/webp,image/gif"
                : "image/png,image/jpeg,image/webp"
            }
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = ""; // 同一文件可重选
            }}
          />
          {/* 裁剪产物经 DataTransfer 注入这里提交；无裁剪时 disabled 阻止提交 */}
          <input ref={hiddenRef} type="file" name="avatar" className="hidden" disabled={!cropped} />
          <Button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-none border border-brand-600 bg-brand-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            <Upload size={14} aria-hidden /> {avatarKey ? "更换头像" : "上传头像"}
          </Button>
          <Button
            type="submit"
            disabled={pending || !cropped}
            className="rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-700 hover:border-brand-500 disabled:opacity-50"
          >
            {pending ? "保存中…" : "保存"}
          </Button>
          {avatarKey && (
            <Button
              type="submit"
              formAction={removeAvatarAction}
              className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3.5 py-2 text-sm text-neutral-600 hover:border-red-300 hover:text-red-600"
            >
              <Trash2 size={14} aria-hidden /> 移除
            </Button>
          )}
        </div>
        {cropped && (
          <p className="mt-2 text-xs text-neutral-400">
            {cropped.type === "image/gif" ? "GIF 原图待上传" : "已裁剪 256×256"}，点「保存」上传
          </p>
        )}
      </form>

      {file && <AvatarCropper file={file} onCancel={() => setFile(null)} onConfirm={onConfirm} />}
    </div>
  );
}
