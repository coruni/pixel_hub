"use client";

import { useActionState, useState } from "react";
import { useAction } from "@/lib/hooks";
import { BTN_DANGER_SM } from "@/lib/ui/cls";
import { deleteMediaAction, uploadMediaAction } from "@/lib/actions/admin-media";

export function MediaDeleteButton({ mediaId, used }: { mediaId: string; used: boolean }) {
  const { run, pending } = useAction();
  if (used) return <span className="text-xs text-neutral-400">使用中</span>;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("确认删除该图片？文件将一并移除。")) return;
        run(() => deleteMediaAction(mediaId));
      }}
      className={BTN_DANGER_SM}
    >
      删除
    </button>
  );
}

export function MediaUploadForm() {
  const [state, formAction, pending] = useActionState(uploadMediaAction, {});
  const [name, setName] = useState("");
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <label className="cursor-pointer rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900">
        {name || "选择图片"}
        <input
          type="file"
          name="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => setName(e.target.files?.[0]?.name ?? "")}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
      >
        {pending ? "上传中…" : "直传"}
      </button>
      {state.ok && <span className="text-xs text-emerald-600">✓ 已上传</span>}
      {state.error && <span className="text-xs text-red-500">{state.error}</span>}
    </form>
  );
}
