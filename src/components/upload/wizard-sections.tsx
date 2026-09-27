"use client";

import { useState } from "react";
import type { UploadLimits } from "@/lib/upload-config";
import { wizInput, wizLabel, SectionTitle, STEP } from "./wizard-shared";
import { AttachmentListEditor, uid, type AttachRow } from "./attachment-list";
import { SquareCheckbox } from "../admin/SquareCheckbox";

/** 下载源清单行的初始值（已有清单回填用）。kind/size 必须一起带回来：kind 决定详情页
 *  「附件 / 外链」标识，size 是站内附件上传时记下的体积，缺了就等于把附件降级成外链。 */
export type InitialDownload = {
  name: string;
  url: string;
  kind?: "file" | "link";
  size?: string;
  note?: string;
};

export function GameSection({
  initial,
  downloads,
  fieldErrors,
  limits,
  onBusyChange,
}: {
  /**
   * 语言 / 平台回填值。平台按「逗号分隔文本」回填（与输入框、草稿字段同形），
   * 服务端 gameMetaSchema 会再按 /[,，、\s]+/ 切成数组——回填时务必用逗号，
   * 用「/」分隔会被切成一个孤立的 "/" 平台。
   */
  initial?: { lang?: string; platforms?: string };
  /** 已有下载源（改稿时来自 meta.downloads）；发布时为空 */
  downloads?: InitialDownload[];
  fieldErrors?: Record<string, string[]>;
  limits: UploadLimits;
  /** 上传任务数量变化：宿主据此禁用提交 */
  onBusyChange?: (busy: number) => void;
}) {
  // 下载源清单是 GAME 唯一的下载入口（原来的「下载外链」必填项已并入本清单）
  const [rows, setRows] = useState<AttachRow[]>(() =>
    (downloads ?? []).map((d) => ({
      key: uid(),
      name: d.name,
      kind: d.kind === "file" ? ("file" as const) : ("link" as const),
      url: d.url,
      size: d.size ?? "",
    })),
  );

  return (
    <section className="mt-4 space-y-4 rounded-none border border-brand-200 bg-surface p-5">
      <SectionTitle n={STEP.TYPE}>游戏信息</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={wizLabel} htmlFor="lang">
            语言
          </label>
          <input
            id="lang"
            name="lang"
            defaultValue={initial?.lang ?? ""}
            maxLength={40}
            placeholder="简体中文 / English…"
            className={wizInput}
          />
        </div>
        <div>
          <label className={wizLabel} htmlFor="platforms">
            平台
          </label>
          <input
            id="platforms"
            name="platforms"
            defaultValue={initial?.platforms ?? ""}
            maxLength={100}
            placeholder="Windows, Android, Switch…"
            className={wizInput}
          />
        </div>
      </div>
      <div className="rounded-none border border-brand-200 p-4">
        <p className="text-sm font-medium text-neutral-700">
          下载源<span className="text-red-500">*</span>
        </p>
        <AttachmentListEditor
          rows={rows}
          setRows={setRows}
          limits={limits}
          errors={fieldErrors?.downloads}
          addLinkLabel="添加附件"
          showSize={false}
          emptyHint="还没有下载源，至少添加一条才能发布"
          onBusyChange={onBusyChange}
        />
      </div>
    </section>
  );
}


/** IMAGE 整包/图包下载（可选）：站内附件(zip) 或 网盘外链，多附件清单；区别于 GAME 版本表 */
export function ImageSection({
  initial,
  fieldErrors,
  limits,
  onBusyChange,
}: {
  initial?: {
    isAiGenerated?: boolean;
    original?: boolean;
    downloads?: { name: string; kind: "file" | "link"; url: string; size?: string }[];
  };
  fieldErrors?: Record<string, string[]>;
  limits: UploadLimits;
  /** 上传任务数量变化：宿主据此禁用提交 */
  onBusyChange?: (busy: number) => void;
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
      <SectionTitle n={STEP.TYPE} tail={<span className="font-normal text-neutral-400">D2 声明</span>}>
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
        <p className="text-sm font-medium text-neutral-700">图包下载</p>
        {/* <p className="mt-0.5 text-xs text-neutral-400">
          可放原画集或网盘链接，没有就跳过。
        </p> */}
        <AttachmentListEditor
          rows={rows}
          setRows={setRows}
          limits={limits}
          errors={fieldErrors?.downloads}
          onBusyChange={onBusyChange}
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
  onBusyChange,
}: {
  initial?: { downloads?: { name: string; kind: "file" | "link"; url: string; size?: string }[] };
  fieldErrors?: Record<string, string[]>;
  limits: UploadLimits;
  /** 上传任务数量变化：宿主据此禁用提交 */
  onBusyChange?: (busy: number) => void;
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
      <SectionTitle n={STEP.TYPE}>附件下载</SectionTitle>

      {/* 与 GAME「下载源」用同一个容器形态（描边盒 + 小标题 + 清单编辑器），
          按钮文案/大小列/空态提示全部对齐，不留「文章一套、游戏一套」的观感差。
          文末清单可选，故标题不带必填星号，空态说明「可选」。 */}
      <div className="rounded-none border border-brand-200 p-4">
        <p className="text-sm font-medium text-neutral-700">下载源</p>
        <AttachmentListEditor
          rows={rows}
          setRows={setRows}
          limits={limits}
          errors={fieldErrors?.downloads}
          addLinkLabel="添加附件"
          showSize={false}
          emptyHint="可选：需要额外下载内容时再添加"
          onBusyChange={onBusyChange}
        />
      </div>
    </section>
  );
}
