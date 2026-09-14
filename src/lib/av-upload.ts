// 上传去向解析（服务端）——三个上传入口（attachment / attachment.session / attachment.complete）
// 共用同一套「后缀白名单 + 体积上限 + 是否走 OneDrive」判定，避免三处各写一遍导致行为漂移。
//
// 关键约束：是否走云盘一律由后台运行配置决定（attachmentCloud / avCloud），代码里不写死。
//   kind=attachment → attachmentCloud + /admin/uploads 的后缀表与上限
//   kind=music|video → avCloud + 内置音视频后缀表，上限沿用附件上限（可到 OneDrive 单文件 250GiB）
//
// 落库的 Media.kind 三种情况都用 ATTACHMENT：MediaKind 是数据库枚举，为上传来源再扩一个值
// 收益极低（音视频与附件的生命周期、清理、引用计数完全一致），代价却是一次不可回退的枚举迁移。

import type { CloudDrive } from "@prisma/client";
import { activeCloudDrive, graphEnabled } from "@/lib/storage/onedrive";
import { attachmentCloudEnabled, avCloudEnabled, getRuntimeConfig } from "@/lib/runtime-config";
import { getUploadLimits } from "@/lib/upload-limits";
import { attachmentExtsSample, MIB } from "@/lib/upload-config";
import { avExtsFor, avExtsSample, type AvKind } from "@/lib/av";

export type UploadKind = "attachment" | "music" | "video";

export function parseUploadKind(v: unknown): UploadKind {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "music" || s === "video" ? s : "attachment";
}

export function avKindForUpload(kind: UploadKind): AvKind | null {
  if (kind === "music") return "audio";
  if (kind === "video") return "video";
  return null;
}

export type UploadTarget = {
  kind: UploadKind;
  /** 有值 = 该次上传经 Microsoft Graph 分片直传；null = 走统一存储驱动 */
  cloud: CloudDrive | null;
  maxBytes: number;
  maxMb: number;
  allowedExts: Set<string>;
  /** 报错提示里的允许后缀样例 */
  extsSample: string;
  /** 面前用户的提示文案主体（附件 / 音频 / 视频） */
  label: string;
};

/** 解析一次上传请求的去向；不落库、不校验具体文件，纯读配置 + 挑活跃盘 */
export async function resolveUploadTarget(kind: UploadKind): Promise<UploadTarget> {
  const cfg = await getRuntimeConfig();
  const limits = await getUploadLimits();
  const avKind = avKindForUpload(kind);

  const cloudWanted = avKind ? avCloudEnabled(cfg) : attachmentCloudEnabled(cfg);
  const cloud = (await graphEnabled()) && cloudWanted ? await activeCloudDrive() : null;

  const allowedExts = new Set<string>(
    avKind ? avExtsFor(avKind) : limits.attachmentExts,
  );

  return {
    kind,
    cloud,
    maxBytes: limits.attachmentMaxMb * MIB,
    maxMb: limits.attachmentMaxMb,
    allowedExts,
    extsSample: avKind
      ? avExtsSample(avKind, 8)
      : attachmentExtsSample(limits.attachmentExts, 10),
    label: avKind ? (avKind === "audio" ? "音频" : "视频") : "附件",
  };
}

/** 从文件名取后缀（小写、不带点）；与上传接口共用的宽松实现 */
export function extFromName(name: string): string {
  return name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
}

/** 统一的体积/后缀拒绝文案；通过则返回 null */
export function rejectFile(t: UploadTarget, name: string, size: number): string | null {
  if (size > t.maxBytes) return `${t.label}不能超过 ${t.maxMb}MB`;
  const ext = extFromName(name);
  if (!t.allowedExts.has(ext))
    return `不支持的${t.label}格式（.${ext || "?"}）。允许：${t.extsSample}`;
  return null;
}
