"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { FileText, Link as LinkIcon, Plus, Trash2, UploadCloud } from "lucide-react";
import {
  attachmentAcceptAttr,
  attachmentExtsSample,
  mbText,
  type UploadLimits,
} from "@/lib/upload-config";
import { uploadAttachment } from "@/lib/upload-attachment-client";
import { fieldErr, wizInput, wizLabel, SectionTitle } from "./wizard-shared";
import { SquareCheckbox } from "../admin/SquareCheckbox";
import { Button } from "@/components/ui/Button";

/** 附件分节只关心附件体积+后缀两个字段 */
type AttachLimits = Pick<UploadLimits, "attachmentMaxMb" | "attachmentExts">;

export function GameSection({
  initial,
  fieldErrors,
  limits,
  showChangelog = false,
}: {
  initial?: {
    externalUrl?: string;
    version?: string;
    size?: string;
    platforms?: string;
    lang?: string;
    license?: string;
    note?: string;
  };
  fieldErrors?: Record<string, string[]>;
  limits: UploadLimits;
  /** 仅发布时创建版本记录需要更新日志；改稿不复用版本，故默认隐藏 */
  showChangelog?: boolean;
}) {
  const [extUrl, setExtUrl] = useState(initial?.externalUrl ?? "");
  const [attUploading, setAttUploading] = useState(false);
  const [attProgress, setAttProgress] = useState<number | null>(null);

  async function onAttachment(file: File | null) {
    if (!file) return;
    setAttUploading(true);
    setAttProgress(0);
    try {
      const data = await uploadAttachment(file, setAttProgress);
      setExtUrl(data.url);
    } catch {
      // 静默失败：用户仍可手动粘贴外链
    } finally {
      setAttUploading(false);
      setAttProgress(null);
    }
  }

  return (
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle n={2}>游戏信息</SectionTitle>
      <div>
        <label className={wizLabel} htmlFor="externalUrl">
          下载外链 *
        </label>
        <input
          id="externalUrl"
          name="externalUrl"
          required
          value={extUrl}
          onChange={(e) => setExtUrl(e.target.value)}
          placeholder="https://pan.xxx / 官网直链…"
          className={wizInput}
        />
        {fieldErr(fieldErrors?.externalUrl)}
        <AttachmentUpload
          uploading={attUploading}
          progress={attProgress}
          onUpload={onAttachment}
          filled={extUrl.startsWith("/")}
          limits={limits}
        />
        {/* <p className="mt-1 text-xs text-neutral-400">
          只发你有权分发的内容，盗版勿发。
        </p> */}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="version">
            版本
          </label>
          <input
            id="version"
            name="version"
            maxLength={40}
            placeholder="v1.2.3"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel} htmlFor="size">
            大小
          </label>
          <input id="size" name="size" maxLength={40} placeholder="1.2 GB" className={wizInput} />
        </div>
      </div>
      {showChangelog && (
        <div>
          <label className={wizLabel} htmlFor="changelog">
            更新日志
          </label>
          <textarea
            id="changelog"
            name="changelog"
            rows={3}
            maxLength={2000}
            placeholder="这个版本包含什么内容…"
            className={wizInput}
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="platforms">
            平台
          </label>
          <input
            id="platforms"
            name="platforms"
            maxLength={100}
            placeholder="Windows / Android / Switch…"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel} htmlFor="lang">
            语言
          </label>
          <input
            id="lang"
            name="lang"
            maxLength={40}
            placeholder="简体中文 / English…"
            className={wizInput}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="license">
            授权
          </label>
          <input
            id="license"
            name="license"
            maxLength={40}
            placeholder="免费 / 商业 / 待授权…"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel} htmlFor="note">
            说明
          </label>
          <input
            id="note"
            name="note"
            maxLength={300}
            placeholder="如：仅供学习交流，请在 24h 内删除"
            className={wizInput}
          />
        </div>
      </div>
    </section>
  );
}

/** 附件直传：成功后回填站内路径（extUrl 受控于父组件）；上限/后缀提示来自后台配置 */
export function AttachmentUpload({
  uploading,
  progress,
  onUpload,
  filled,
  limits,
}: {
  uploading: boolean;
  progress?: number | null;
  onUpload: (file: File | null) => void;
  filled: boolean;
  limits: AttachLimits;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900">
        <UploadCloud size={14} aria-hidden />
        {uploading ? (progress == null ? "上传中…" : `上传中 ${progress}%`) : "或直接上传文件"}
        <input
          type="file"
          hidden
          disabled={uploading}
          accept={attachmentAcceptAttr(limits.attachmentExts)}
          onChange={(e) => onUpload(e.target.files?.[0] ?? null)}
        />
      </label>
      {filled && <span className="text-xs text-emerald-600">✓ 已上传站内附件</span>}
      <span className="text-xs text-neutral-400">
        {`支持 ${attachmentExtsSample(limits.attachmentExts, 6)} 格式，单文件 ${mbText(limits.attachmentMaxMb)}`}
      </span>
    </div>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** 附件直传：OneDrive 走浏览器分片直传，其他存储回退既有 API */
async function postAttachment(
  file: File,
): Promise<{ url: string; name: string; size: number } | null> {
  try {
    return await uploadAttachment(file);
  } catch {
    return null;
  }
}

export type AttachRow = {
  key: string;
  name: string;
  kind: "file" | "link";
  url: string;
  size: string;
};

let uidSeed = 0;
const uid = () => `att-${++uidSeed}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 多附件清单编辑器：IMAGE「整包/图包」与 ARTICLE「文末清单」共用。
 * 站内附件上传 + 网盘外链逐行增删；每行独立 kind，切换/增删互相隔离，不会串数据。
 * 隐藏字段 downloads 由本组件受控序列化（客户端唯一来源）。
 */
export function AttachmentListEditor({
  rows,
  setRows,
  limits,
  errors,
  addLinkLabel = "添加网盘外链",
}: {
  rows: AttachRow[];
  setRows: Dispatch<SetStateAction<AttachRow[]>>;
  limits: UploadLimits;
  errors?: string[];
  addLinkLabel?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    try {
      const r = await postAttachment(file);
      if (!r) {
        setMsg("附件上传失败，请重试");
        return;
      }
      setRows((p) => [
        ...p,
        { key: uid(), kind: "file", name: r.name, url: r.url, size: formatBytes(r.size) },
      ]);
    } catch {
      setMsg("附件上传失败，请重试");
    } finally {
      setUploading(false);
      setFileKey((k) => k + 1); // 同一文件可重复选择
    }
  }

  function addLink() {
    setRows((p) =>
      p.length >= 20 ? p : [...p, { key: uid(), kind: "link", name: "", url: "", size: "" }],
    );
  }

  function patch(i: number, part: Partial<Omit<AttachRow, "key">>) {
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...part } : r)));
  }

  function remove(i: number) {
    setRows((p) => p.filter((_, idx) => idx !== i));
  }

  const payload = rows
    .filter((r) => r.name.trim() || r.url.trim())
    .map((r) => ({
      name: r.name.trim(),
      kind: r.kind,
      url: r.url.trim(),
      size: r.size.trim() || undefined,
    }));

  const addBtn =
    "inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 transition hover:border-brand-400 hover:text-neutral-900 disabled:opacity-50";

  return (
    <>
      {errors && errors.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {errors.map((e, i) => (
            <li key={i} className="text-xs text-red-600">
              {e}
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <li
              key={r.key}
              className="flex flex-wrap items-center gap-2 rounded-none border border-brand-200 bg-surface p-2.5"
            >
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-none border px-2 py-0.5 text-[11px] font-medium ${
                  r.kind === "file"
                    ? "border-brand-200 bg-brand-50 text-brand-700"
                    : "border-sky-200 bg-sky-50 text-sky-700"
                }`}
              >
                {r.kind === "file" ? (
                  <FileText size={11} aria-hidden />
                ) : (
                  <LinkIcon size={11} aria-hidden />
                )}
                {r.kind === "file" ? "附件" : "外链"}
              </span>
              <input
                value={r.name}
                onChange={(e) => patch(i, { name: e.target.value })}
                maxLength={120}
                required
                placeholder="附件名"
                aria-label="附件名"
                className="min-w-0 flex-1 rounded-none border border-brand-200 bg-surface px-2 py-1.5 text-sm text-neutral-800 focus:border-brand-500 focus:outline-none"
              />
              {r.kind === "file" ? (
                <span className="max-w-48 truncate text-xs text-neutral-400" title={r.url}>
                  {r.url}
                </span>
              ) : (
                <input
                  value={r.url}
                  onChange={(e) => patch(i, { url: e.target.value })}
                  maxLength={2000}
                  required
                  placeholder="https://pan.xxx / 官网直链…"
                  aria-label="下载地址"
                  className="w-56 rounded-none border border-brand-200 bg-surface px-2 py-1.5 text-sm text-neutral-800 focus:border-brand-500 focus:outline-none"
                />
              )}
              <input
                value={r.size}
                onChange={(e) => patch(i, { size: e.target.value })}
                maxLength={40}
                placeholder="大小"
                aria-label="大小"
                className="w-20 rounded-none border border-brand-200 bg-surface px-2 py-1.5 text-sm text-neutral-800 focus:border-brand-500 focus:outline-none"
              />
              <Button
                type="button"
                onClick={() => remove(i)}
                aria-label="移除该附件"
                className="rounded-none p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <AttachmentUpload
          key={fileKey}
          uploading={uploading}
          onUpload={onFile}
          filled={false}
          limits={limits}
        />
        <Button type="button" onClick={addLink} disabled={rows.length >= 20} className={addBtn}>
          <Plus size={13} aria-hidden /> {addLinkLabel}
        </Button>
        <span className="text-xs tabular-nums text-neutral-400">{rows.length}/20</span>
        {msg && <span className="text-xs text-amber-600">{msg}</span>}
      </div>

      {/* 附件清单隐藏字段（单 JSON，客户端受控 state 序列化，规避多兄弟 key 顺序脆弱） */}
      <input type="hidden" name="downloads" value={JSON.stringify(payload)} />
    </>
  );
}

/** IMAGE 整包/图包下载（可选）：站内附件(zip) 或 网盘外链，多附件清单；区别于 GAME 版本表 */
export function ImageSection({
  initial,
  fieldErrors,
  limits,
}: {
  initial?: {
    isAiGenerated?: boolean;
    original?: boolean;
    downloads?: { name: string; kind: "file" | "link"; url: string; size?: string }[];
  };
  fieldErrors?: Record<string, string[]>;
  limits: UploadLimits;
}) {
  const [rows, setRows] = useState<AttachRow[]>(
    (initial?.downloads ?? []).map((d) => ({
      key: uid(),
      name: d.name,
      kind: d.kind,
      url: d.url,
      size: d.size ?? "",
    })),
  );

  return (
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle n={2} tail={<span className="font-normal text-neutral-400">D2 声明</span>}>
        图片信息
      </SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-none border border-brand-200 px-3 py-2.5 text-sm text-neutral-700">
          <SquareCheckbox name="isAiGenerated" defaultChecked={initial?.isAiGenerated} ariaLabel="由 AI 生成" />
          由 AI 生成
        </label>
        <label className="flex items-center gap-2 rounded-none border border-brand-200 px-3 py-2.5 text-sm text-neutral-700">
          <SquareCheckbox name="original" defaultChecked={initial?.original} ariaLabel="本人原创" />
          本人原创
        </label>
      </div>

      <div className="rounded-none border border-brand-200 p-4">
        <p className="text-sm font-medium text-neutral-700">整包 / 图包下载（可选）</p>
        {/* <p className="mt-0.5 text-xs text-neutral-400">
          可放原画集或网盘链接，没有就跳过。
        </p> */}
        <AttachmentListEditor
          rows={rows}
          setRows={setRows}
          limits={limits}
          errors={fieldErrors?.downloads}
        />
      </div>
    </section>
  );
}

/** ARTICLE 文末附件清单（可选）：站内附件 / 网盘外链多行，逐行展示于详情页底部 */
export function ArticleSection({
  initial,
  fieldErrors,
  limits,
}: {
  initial?: { downloads?: { name: string; kind: "file" | "link"; url: string; size?: string }[] };
  fieldErrors?: Record<string, string[]>;
  limits: UploadLimits;
}) {
  const [rows, setRows] = useState<AttachRow[]>(
    (initial?.downloads ?? []).map((d) => ({
      key: uid(),
      name: d.name,
      kind: d.kind,
      url: d.url,
      size: d.size ?? "",
    })),
  );

  return (
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle
        n={2}
        tail={<span className="font-normal text-neutral-400">文末清单 · 可选</span>}
      >
        附件下载
      </SectionTitle>

      <AttachmentListEditor
        rows={rows}
        setRows={setRows}
        limits={limits}
        errors={fieldErrors?.downloads}
      />
    </section>
  );
}
