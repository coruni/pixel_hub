"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMediaAction, uploadMediaAction } from "@/lib/actions/admin-media";

const b = "rounded-none px-3 py-1.5 text-xs font-medium transition disabled:opacity-50";

export function MediaDeleteButton({ mediaId, used }: { mediaId: string; used: boolean }) {
 const router = useRouter();
 const [pending, start] = useTransition();
 if (used) return <span className="text-xs text-neutral-400">使用中</span>;
 return (
 <button
 disabled={pending}
 onClick={() => {
 if (!window.confirm("确认删除该图片？文件将一并移除。")) return;
 start(async () => {
 const r = await deleteMediaAction(mediaId);
 if (!r.ok) window.alert(r.error ?? "操作失败");
 else router.refresh();
 });
 }}
 className={`${b} border border-red-300 text-red-600 hover:bg-red-50`}
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

