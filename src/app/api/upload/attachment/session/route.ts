import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { sameOrigin } from "@/lib/origin";
import { rateLimit } from "@/lib/rate-limit";
import {
  cloudItemPathFor,
  createDriveUploadSession,
  createDriveUploadTicket,
} from "@/lib/storage/onedrive";
import { MIB } from "@/lib/upload-config";
import { parseUploadKind, rejectFile, resolveUploadTarget } from "@/lib/av-upload";

export const runtime = "nodejs";

/**
 * 只创建 OneDrive upload session，不接收文件内容。
 * 浏览器拿到 uploadUrl 后直接向 Graph 分片上传，避免 Vercel Function 代理大文件。
 * kind=attachment|music|video 决定后缀白名单与云盘开关（见 av-upload.ts），全部由后台配置驱动。
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
    kind?: unknown;
  } | null;
  const kind = parseUploadKind(body?.kind);
  const name = typeof body?.name === "string" ? body.name.replace(/[\\/]/g, "_").slice(0, 120) : "";
  const size = typeof body?.size === "number" ? body.size : NaN;
  if (!name || !Number.isSafeInteger(size) || size <= 0)
    return NextResponse.json({ ok: false, error: "文件信息无效" }, { status: 400 });

  const target = await resolveUploadTarget(kind);
  const rejected = rejectFile(target, name, size);
  if (rejected) return NextResponse.json({ ok: false, error: rejected }, { status: 400 });

  // 去重：同一用户已上传过同名同大小的文件 → 直接复用已完成记录，跳过整轮 Graph 上传
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

  const cloud = target.cloud;
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
