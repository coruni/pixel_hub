import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { makeKey, saveFile } from "@/lib/storage";
import { attachmentCloudEnabled, getRuntimeConfig } from "@/lib/runtime-config";
import { rateLimit } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/origin";
import {
  activeCloudDrive,
  cloudRelKey,
  graphEnabled,
  itemPathFor,
  makeCloudRef,
  recordDriveError,
  recordDriveOk,
  uploadDriveFile,
} from "@/lib/storage/onedrive";
import { MIB, attachmentExtsSample } from "@/lib/upload-config";
import { getUploadLimits } from "@/lib/upload-limits";

export const runtime = "nodejs";
// 兼容旧调用方的单请求路径；OneDrive 新客户端走 session 直传，不占 Vercel 文件传输资源。
export const maxDuration = 60;

const DIRECT_UPLOAD_MAX_BYTES = 250 * MIB;

// 附件直传：任意分发格式（压缩包/文档等），单文件上限与允许后缀由后台 /admin/uploads
// 配置决定（见 getUploadLimits），缺失回退默认（200MB + 内置后缀表）。
// 落 Media(kind=ATTACHMENT) 记录；返回的 url 供发布时填 externalUrl / 版本 url。

export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json({ ok: false, error: "跨站请求被拒绝" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  // 附件体积大（≤后台配置上限）：比图片更紧的限流，防存储滥用
  if (!rateLimit(`attach:${session.user.id}`, 10, 60 * 60_000))
    return NextResponse.json({ ok: false, error: "上传过于频繁，请稍后再试" }, { status: 429 });

  const L = await getUploadLimits();
  const maxBytes = L.attachmentMaxMb * MIB;
  const allowedExts = new Set(L.attachmentExts);
  const cfg = await getRuntimeConfig();
  const cloud = (await graphEnabled()) && attachmentCloudEnabled(cfg) ? await activeCloudDrive() : null;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "未收到文件" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return NextResponse.json(
      { ok: false, error: `文件不能超过 ${L.attachmentMaxMb}MB` },
      { status: 400 },
    );
  }
  if (file.size > DIRECT_UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        code: cloud ? "USE_UPLOAD_SESSION" : "STORAGE_LIMIT",
        error: cloud
          ? "大文件请使用支持分片上传的客户端"
          : "当前存储未启用 OneDrive，暂不支持超过 250MB 的附件",
      },
      { status: 413 },
    );
  }

  const name = (file.name || "file").replace(/[\\/]/g, "_");
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (!allowedExts.has(ext)) {
    return NextResponse.json(
      {
        ok: false,
        error: `不支持的附件格式（.${ext || "?"}）。允许：${attachmentExtsSample(L.attachmentExts, 10)}`,
      },
      { status: 400 },
    );
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());

    // 云附件：Graph 已配置且有活跃盘 → 大附件写云盘并返回自描述引用 /od/{driveId}/{itemPath}；
    // 否则原样走统一存储层（local/s3/chevereto）。配置了云盘但上传失败 → 显式 500 + 记 lastError，不静默回退。
    let url: string;
    try {
      if (cloud) {
        const itemPath = itemPathFor(cloud, cloudRelKey(`.${ext}`));
        await uploadDriveFile(cloud, itemPath, buf);
        url = makeCloudRef(cloud.id, itemPath);
        await recordDriveOk(cloud.id).catch(() => {});
      } else {
        const key = makeKey("files", `.${ext}`);
        url = await saveFile(key, buf);
      }
    } catch (e) {
      if (cloud) await recordDriveError(cloud.id, (e as Error).message).catch(() => {});
      throw e;
    }

    const media = await prisma.media.create({
      data: {
        kind: "ATTACHMENT",
        uploaderId: session.user.id,
        storageKey: url,
        size: buf.byteLength,
        mime: file.type || null,
        fileName: name.slice(0, 120),
        status: "READY",
      },
    });
    return NextResponse.json({ ok: true, id: media.id, url, name, size: buf.byteLength });
  } catch (e) {
    console.error("[upload-attachment]", e);
    return NextResponse.json({ ok: false, error: "上传失败，请重试" }, { status: 500 });
  }
}
