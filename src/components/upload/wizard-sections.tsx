"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { FileText, Link as LinkIcon, Plus, Trash2, UploadCloud } from "lucide-react";
import {
  attachmentAcceptAttr,
  attachmentExtsSample,
  mbText,
  type UploadLimits,
} from "@/lib/upload-config";
import { uploadAttachment } from "@/lib/upload-attachment-client";
import { fieldErr, wizInput, wizLabel, SectionTitle } from "./wizard-shared";

/** 附件分节只关心附件体积+后缀两个字段 */
type AttachLimits = Pick<UploadLimits, "attachmentMaxMb" | "attachmentExts">;

/** 发布向导的类型化分节：游戏信息（外链 + 版本/平台等元数据）、图片 D2 声明、图片整包下载、文章附件清单 */

export function GameSection({
  extUrl,
  setExtUrl,
  fieldErrors,
  attachment,
}: {
  extUrl: string;
  setExtUrl: (v: string) => void;
  fieldErrors?: Record<string, string[]>;
  /** 外链输入框下方的附件直传区（由父组件渲染，保持 extUrl 受控在向导层） */
  attachment?: ReactNode;
}) {
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
        {attachment}
        <p className="mt-1 text-xs text-neutral-400">
          仅允许发布<b>有权分发</b>的内容（原创/已获授权/免费资源）。严禁盗版与侵权资源。
        </p>
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

/** 附件直传：成功后回填站内路径到外链输入框（受控由父组件持有 extUrl）；上限/后缀提示来自后台配置 */
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

/** 附件直传：OneDrive 使用浏览器分片直传，其他存储回退既有 API。 */
async function postAttachment(
  file: File,
): Promise<{ url: string; name: string; size: number } | null> {
  try {
    return await uploadAttachment(file);
  } catch {
    return null;
  }
}

const segBase =
  "rounded-none border px-3.5 py-2 text-sm transition disabled:opacity-60 aria-pressed:border-brand-600 aria-pressed:bg-brand-500 aria-pressed:text-white";
const segIdle = "border-brand-200 bg-surface text-neutral-600 hover:border-brand-400";

/** IMAGE 整包/图包下载（可选）：站内附件(zip) 或 网盘外链，单条主下载，区别于 GAME 版本表 */
export function ImageSection({
  fieldErrors,
  limits,
}: {
  fieldErrors?: Record<string, string[]>;
  limits: AttachLimits;
}) {
  const [dlMode, setDlMode] = useState<"none" | "file" | "link">("none");
  const [dlUrl, setDlUrl] = useState("");
  const [dlName, setDlName] = useState("");
  const [dlSize, setDlSize] = useState("");
  const [dlUploading, setDlUploading] = useState(false);
  const [dlKey, setDlKey] = useState(0);
  const [dlMsg, setDlMsg] = useState<string | null>(null);

  function pickMode(k: "none" | "file" | "link") {
    setDlMode(k);
    if (k === "none") {
      setDlUrl("");
      setDlName("");
      setDlSize("");
    }
  }

  async function onDlFile(file: File | null) {
    if (!file) return;
    setDlUploading(true);
    setDlMsg(null);
    try {
      const r = await postAttachment(file);
      if (!r) {
        setDlMsg("附件上传失败，请重试");
        return;
      }
      setDlMode("file");
      setDlUrl(r.url);
      setDlName(r.name);
      setDlSize(formatBytes(r.size));
    } finally {
      setDlUploading(false);
      setDlKey((k) => k + 1); // 重挂载内部 file input，同一文件可再次选择
    }
  }

  const dlSegs: { k: "none" | "file" | "link"; label: string }[] = [
    { k: "none", label: "不提供下载" },
    { k: "file", label: "站内附件（zip 等）" },
    { k: "link", label: "网盘外链" },
  ];

  return (
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle n={2} tail={<span className="font-normal text-neutral-400">D2 声明</span>}>
        图片信息
      </SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-none border border-brand-200 px-3 py-2.5 text-sm text-neutral-700">
          <input type="checkbox" name="isAiGenerated" className="h-4 w-4 accent-brand-500" />由 AI
          生成
        </label>
        <label className="flex items-center gap-2 rounded-none border border-brand-200 px-3 py-2.5 text-sm text-neutral-700">
          <input type="checkbox" name="original" className="h-4 w-4 accent-brand-500" />
          本人原创
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="aiTool">
            生成工具（如选 AI）
          </label>
          <input
            id="aiTool"
            name="aiTool"
            maxLength={60}
            placeholder="Midjourney / Stable Diffusion…"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel} htmlFor="aiModel">
            模型/参数（可选）
          </label>
          <input
            id="aiModel"
            name="aiModel"
            maxLength={60}
            placeholder="v6.1 / SDXL…"
            className={wizInput}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="license">
            授权/许可（可选）
          </label>
          <input
            id="license"
            name="license"
            maxLength={40}
            placeholder="仅自用 / CC BY / 可商用…"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel} htmlFor="sourceNote">
            素材来源（转素材请填）
          </label>
          <input
            id="sourceNote"
            name="sourceNote"
            maxLength={200}
            placeholder="作者/原址，避免侵权纠纷"
            className={wizInput}
          />
        </div>
      </div>

      {/* 整包 / 图包下载（可选）—— 单条整套下载，区别于 GAME 的版本/平台表 */}
      <div className="rounded-none border border-brand-200 p-4">
        <p className="text-sm font-medium text-neutral-700">整包 / 图包下载（可选）</p>
        <p className="mt-0.5 text-xs text-neutral-400">
          提供原画集 / 多图整套 zip 或网盘链接；不提供可跳过。
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="下载方式">
          {dlSegs.map((s) => (
            <button
              key={s.k}
              type="button"
              aria-pressed={dlMode === s.k}
              onClick={() => pickMode(s.k)}
              className={`${segBase} ${dlMode === s.k ? "" : segIdle}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {dlMode === "file" && (
          <div className="mt-3">
            <AttachmentUpload
              key={dlKey}
              uploading={dlUploading}
              onUpload={onDlFile}
              filled={!!dlUrl}
              limits={limits}
            />
            {dlMsg && <p className="mt-1 text-xs text-amber-600">{dlMsg}</p>}
            {dlUrl && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={wizLabel} htmlFor="dlName">
                    文件名（展示）
                  </label>
                  <input
                    id="dlName"
                    value={dlName}
                    onChange={(e) => setDlName(e.target.value)}
                    maxLength={120}
                    placeholder="图包.zip"
                    className={wizInput}
                  />
                </div>
                <div>
                  <label className={wizLabel} htmlFor="dlSize">
                    大小（展示）
                  </label>
                  <input
                    id="dlSize"
                    value={dlSize}
                    onChange={(e) => setDlSize(e.target.value)}
                    maxLength={40}
                    placeholder="128 MB"
                    className={wizInput}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        {dlMode === "link" && (
          <div className="mt-3 space-y-3">
            <div>
              <label className={wizLabel} htmlFor="dlLinkUrl">
                网盘 / 下载地址 *
              </label>
              <input
                id="dlLinkUrl"
                required
                value={dlUrl}
                onChange={(e) => setDlUrl(e.target.value)}
                placeholder="https://pan.xxx / 官网直链…"
                className={wizInput}
              />
              {fieldErr(fieldErrors?.downloadUrl)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={wizLabel} htmlFor="dlLinkName">
                  文件名（展示，可选）
                </label>
                <input
                  id="dlLinkName"
                  value={dlName}
                  onChange={(e) => setDlName(e.target.value)}
                  maxLength={120}
                  placeholder="整套素材"
                  className={wizInput}
                />
              </div>
              <div>
                <label className={wizLabel} htmlFor="dlLinkSize">
                  大小（展示，可选）
                </label>
                <input
                  id="dlLinkSize"
                  value={dlSize}
                  onChange={(e) => setDlSize(e.target.value)}
                  maxLength={40}
                  placeholder="128 MB"
                  className={wizInput}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 下载配置隐藏字段（仅 IMAGE 挂载时进入 FormData；受控 state 为唯一来源） */}
      <input type="hidden" name="dlMode" value={dlMode} />
      <input type="hidden" name="dlUrl" value={dlUrl} />
      {dlMode !== "none" && (
        <>
          <input type="hidden" name="dlName" value={dlName} />
          <input type="hidden" name="dlSize" value={dlSize} />
        </>
      )}

      <p className="text-xs text-neutral-400">
        上传图片需尊重版权：转载须注明来源，AI 生成建议如实标注。
      </p>
    </section>
  );
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

/** ARTICLE 文末附件清单（可选）：站内附件 / 网盘外链多行，逐行展示于详情页底部 */
export function ArticleSection({
  fieldErrors,
  limits,
}: {
  fieldErrors?: Record<string, string[]>;
  limits: AttachLimits;
}) {
  const [rows, setRows] = useState<AttachRow[]>([]);
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
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle
        n={2}
        tail={<span className="font-normal text-neutral-400">文末清单 · 可选</span>}
      >
        附件下载
      </SectionTitle>
      <p className="-mt-2 text-xs text-neutral-400">
        附件将以清单形式展示在文章底部，访客逐行下载。
      </p>

      {fieldErr(fieldErrors?.downloads)}

      {rows.length > 0 && (
        <ul className="space-y-2">
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
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="移除该附件"
                className="rounded-none p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <AttachmentUpload
          key={fileKey}
          uploading={uploading}
          onUpload={onFile}
          filled={false}
          limits={limits}
        />
        <button type="button" onClick={addLink} disabled={rows.length >= 20} className={addBtn}>
          <Plus size={13} aria-hidden /> 添加网盘外链
        </button>
        <span className="text-xs tabular-nums text-neutral-400">{rows.length}/20</span>
        {msg && <span className="text-xs text-amber-600">{msg}</span>}
      </div>

      {/* 附件清单隐藏字段（单 JSON，客户端受控 state 序列化，规避多兄弟 key 顺序脆弱） */}
      <input type="hidden" name="downloads" value={JSON.stringify(payload)} />
    </section>
  );
}
