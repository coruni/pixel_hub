"use client";

import { useActionState, useState, useTransition } from "react";
import { Download, Plus, UploadCloud } from "lucide-react";
import {
  addVersionAction,
  bumpVersionDownloadAction,
  type ResourceActionState,
} from "@/lib/actions/resource";
import { INPUT } from "@/lib/ui/cls";

/** 单个版本的下载：新窗口打开地址 + 计数（会话去重） */
export function VersionDownloadButton({
  versionId,
  url,
  count,
}: {
  versionId: string;
  url: string;
  count: number;
}) {
  const [n, setN] = useState(count);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await bumpVersionDownloadAction(versionId);
          setN((x) => x + 1);
          window.open(url, "_blank", "noopener");
        })
      }
      className="inline-flex items-center gap-1 rounded-none border border-emerald-600 bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
    >
      <Download size={12} aria-hidden />
      下载 {n > 0 ? n : ""}
    </button>
  );
}

/** 作者追加新版本（可折叠表单） */
export function VersionForm({ resourceId }: { resourceId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ResourceActionState, FormData>(
    addVersionAction,
    {},
  );
  // 下载地址受控：附件直传成功后回填站内路径
  const [url, setUrl] = useState("");
  const [attUploading, setAttUploading] = useState(false);

  async function onAttachment(file: File | null) {
    if (!file) return;
    setAttUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/upload/attachment", { method: "POST", body: fd });
      const data = await res.json();
      if (data.ok) setUrl(data.url as string);
    } finally {
      setAttUploading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-none border border-brand-200 bg-surface px-3 py-1 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900"
      >
        <Plus size={12} aria-hidden /> 发布新版本
      </button>
      {open && (
        <form
          action={formAction}
          className="mt-3 space-y-3 rounded-none border border-brand-200 bg-surface p-4"
        >
          <input type="hidden" name="resourceId" value={resourceId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-neutral-500" htmlFor="v-version">
                版本号 *
              </label>
              <input
                id="v-version"
                name="version"
                required
                maxLength={40}
                className={INPUT}
                placeholder="如 1.1.0"
              />
              {state.fieldErrors?.version && (
                <p className="mt-1 text-xs text-red-500">{state.fieldErrors.version[0]}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500" htmlFor="v-url">
                下载地址（缺省沿用当前）
              </label>
              <input
                id="v-url"
                name="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={INPUT}
                placeholder="https://… 或上传文件"
              />
              {state.fieldErrors?.url && (
                <p className="mt-1 text-xs text-red-500">{state.fieldErrors.url[0]}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900">
              <UploadCloud size={13} aria-hidden />
              {attUploading ? "上传中…" : "上传文件"}
              <input
                type="file"
                hidden
                disabled={attUploading}
                onChange={(e) => onAttachment(e.target.files?.[0] ?? null)}
              />
            </label>
            {url.startsWith("/") && (
              <span className="text-xs text-emerald-600">✓ 已上传站内附件</span>
            )}
            <span className="text-xs text-neutral-400">zip/7z/pdf 等，≤200MB</span>
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500" htmlFor="v-changelog">
              更新日志
            </label>
            <textarea
              id="v-changelog"
              name="changelog"
              rows={3}
              maxLength={2000}
              className={INPUT}
              placeholder="这个版本改了什么…"
            />
          </div>
          {state.ok && <p className="text-xs text-emerald-600">✓ 新版本已发布</p>}
          {state.error && <p className="text-xs text-red-500">{state.error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={pending}
              className="rounded-none border border-brand-600 bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {pending ? "发布中…" : "发布版本"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
