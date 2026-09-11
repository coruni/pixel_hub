import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { sameOrigin } from "@/lib/origin";
import { rateLimit } from "@/lib/rate-limit";
import {
  activeCloudDrive,
  cloudItemPathFor,
  createDriveUploadSession,
  createDriveUploadTicket,
  graphEnabled,
} from "@/lib/storage/onedrive";
import { MIB, attachmentExtsSample } from "@/lib/upload-config";
import { getUploadLimits } from "@/lib/upload-limits";
import { attachmentCloudEnabled, getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

/**
 * 只创建 OneDrive upload session，不接收文件内容。
 * 浏览器拿到 uploadUrl 后直接向 Graph 分片上传，避免 Vercel Function 代理大文件。
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json({ ok: false, error: "跨站请求被拒绝" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  if (!(await rateLimit(`attach-session:${session.user.id}`, 10, 60 * 60_000)))
    return NextResponse.json({ ok: false, error: "上传过于频繁，请稍后再试" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    size?: unknown;
    mime?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.replace(/[\\/]/g, "_").slice(0, 120) : "";
  const size = typeof body?.size === "number" ? body.size : NaN;
  if (!name || !Number.isSafeInteger(size) || size <= 0)
    return NextResponse.json({ ok: false, error: "文件信息无效" }, { status: 400 });

  const limits = await getUploadLimits();
  const maxBytes = limits.attachmentMaxMb * MIB;
  if (size > maxBytes)
    return NextResponse.json(
      { ok: false, error: `文件不能超过 ${limits.attachmentMaxMb}MB` },
      { status: 400 },
    );

  const ext = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  const allowedExts = new Set(limits.attachmentExts);
  if (!allowedExts.has(ext))
    return NextResponse.json(
      {
        ok: false,
        error: `不支持的附件格式（.${ext || "?"}）。允许：${attachmentExtsSample(limits.attachmentExts, 10)}`,
      },
      { status: 400 },
    );

  // 去重：同一用户已上传过同名同大小的附件 → 直接复用已完成记录，跳过整轮 Graph 上传
  // （仅比对 name+size：浏览器直传场景服务端不接触字节，无法算内容 hash；同名同大小视为同一文件）
  const dup = await prisma.media.findFirst({
    where: {
      kind: "ATTACHMENT",
      uploaderId: session.user.id,
      fileName: name,
      size,
      status: "READY",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, storageKey: true, fileName: true, size: true },
  });
  if (dup)
    return NextResponse.json({
      ok: true,
      deduped: true,
      id: dup.id,
      url: dup.storageKey,
      name: dup.fileName,
      size: dup.size,
    });

  const cfg = await getRuntimeConfig();
  const cloud = (await graphEnabled()) && attachmentCloudEnabled(cfg) ? await activeCloudDrive() : null;
  if (!cloud)
    return NextResponse.json(
      { ok: false, code: "NO_CLOUD", error: "未启用活跃 OneDrive 云盘" },
      { status: 409 },
    );

  try {
    // 落盘名 = 原名_uuid（原名供下载直接使用，uuid 防重复/并发覆盖）
    const itemPath = cloudItemPathFor(cloud, name);
    const upload = await createDriveUploadSession(cloud, itemPath);
    const ticket = await createDriveUploadTicket({
      driveId: cloud.id,
      itemPath,
      size,
      name,
      mime: typeof body?.mime === "string" && body.mime ? body.mime.slice(0, 120) : null,
      userId: session.user.id,
    });
    return NextResponse.json({
      ok: true,
      ticket,
      uploadUrl: upload.uploadUrl,
      expirationDateTime: upload.expirationDateTime,
      chunkSize: 10 * MIB,
    });
  } catch (e) {
    console.error("[upload-attachment-session]", e);
    return NextResponse.json({ ok: false, error: "创建 OneDrive 上传会话失败" }, { status: 502 });
  }
}
