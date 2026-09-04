"use client";

import type { ReactNode } from "react";
import { UploadCloud } from "lucide-react";
import { fieldErr, wizInput, wizLabel, SectionTitle } from "./wizard-shared";

/** 发布向导的类型化分节：游戏信息（外链 + 版本/平台等元数据）、图片 D2 声明 */

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
        <label className={wizLabel} htmlFor="externalUrl">下载外链 *</label>
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
        <p className="mt-1 text-xs text-neutral-400">仅允许发布<b>有权分发</b>的内容（原创/已获授权/免费资源）。严禁盗版与侵权资源。</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="version">版本</label>
          <input id="version" name="version" maxLength={40} placeholder="v1.2.3" className={wizInput} />
        </div>
        <div>
          <label className={wizLabel} htmlFor="size">大小</label>
          <input id="size" name="size" maxLength={40} placeholder="1.2 GB" className={wizInput} />
        </div>
      </div>
      <div>
        <label className={wizLabel} htmlFor="changelog">更新日志</label>
        <textarea id="changelog" name="changelog" rows={3} maxLength={2000} placeholder="这个版本包含什么内容…" className={wizInput} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="platforms">平台</label>
          <input id="platforms" name="platforms" maxLength={100} placeholder="Windows / Android / Switch…" className={wizInput} />
        </div>
        <div>
          <label className={wizLabel} htmlFor="lang">语言</label>
          <input id="lang" name="lang" maxLength={40} placeholder="简体中文 / English…" className={wizInput} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="license">授权</label>
          <input id="license" name="license" maxLength={40} placeholder="免费 / 商业 / 待授权…" className={wizInput} />
        </div>
        <div>
          <label className={wizLabel} htmlFor="note">说明</label>
          <input id="note" name="note" maxLength={300} placeholder="如：仅供学习交流，请在 24h 内删除" className={wizInput} />
        </div>
      </div>
    </section>
  );
}

/** 附件直传：成功后回填站内路径到外链输入框（受控由父组件持有 extUrl） */
export function AttachmentUpload({
  uploading,
  onUpload,
  filled,
}: {
  uploading: boolean;
  onUpload: (file: File | null) => void;
  filled: boolean;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:border-brand-500 hover:text-neutral-900">
        <UploadCloud size={14} aria-hidden />
        {uploading ? "上传中…" : "或直接上传文件"}
        <input
          type="file"
          hidden
          disabled={uploading}
          onChange={(e) => onUpload(e.target.files?.[0] ?? null)}
        />
      </label>
      {filled && <span className="text-xs text-emerald-600">✓ 已上传站内附件</span>}
      <span className="text-xs text-neutral-400">zip/7z/pdf/音频视频等，≤200MB</span>
    </div>
  );
}

export function ImageSection() {
  return (
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle n={2} tail={<span className="font-normal text-neutral-400">D2 声明</span>}>
        图片信息
      </SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-none border border-brand-200 px-3 py-2.5 text-sm text-neutral-700">
          <input type="checkbox" name="isAiGenerated" className="h-4 w-4 accent-brand-500" />
          由 AI 生成
        </label>
        <label className="flex items-center gap-2 rounded-none border border-brand-200 px-3 py-2.5 text-sm text-neutral-700">
          <input type="checkbox" name="original" className="h-4 w-4 accent-brand-500" />
          本人原创
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="aiTool">生成工具（如选 AI）</label>
          <input id="aiTool" name="aiTool" maxLength={60} placeholder="Midjourney / Stable Diffusion…" className={wizInput} />
        </div>
        <div>
          <label className={wizLabel} htmlFor="aiModel">模型/参数（可选）</label>
          <input id="aiModel" name="aiModel" maxLength={60} placeholder="v6.1 / SDXL…" className={wizInput} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="license">授权/许可（可选）</label>
          <input id="license" name="license" maxLength={40} placeholder="仅自用 / CC BY / 可商用…" className={wizInput} />
        </div>
        <div>
          <label className={wizLabel} htmlFor="sourceNote">素材来源（转素材请填）</label>
          <input id="sourceNote" name="sourceNote" maxLength={200} placeholder="作者/原址，避免侵权纠纷" className={wizInput} />
        </div>
      </div>
      <p className="text-xs text-neutral-400">上传图片需尊重版权：转载须注明来源，AI 生成建议如实标注。</p>
    </section>
  );
}
