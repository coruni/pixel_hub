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
import { GRAPH_CHUNK_BYTES } from "@/lib/upload-config";
import { parseUploadKind, rejectFile, resolveUploadTarget } from "@/lib/av-upload";

export const runtime = "nodejs";

/**
 * 只创建一个上传会话，不接收文件内容。三种回答：
 *
 * ① 云盘可用 → 返回 Graph 的 uploadUrl，浏览器直传分片，本站只处理小 JSON 请求。
 * ② 无云盘但存储驱动能流式写 → `mode: "driver"`，返回本站 `/attachment/stream` 的 PUT 地址，
 *    请求体就是文件字节、边收边落盘（本地/自建磁盘因此能吃下 2GB 级音视频）。
 * ③ 无云盘且驱动不支持流式（s3 / chevereto）→ `code: "NO_CLOUD"`，调用方回退 `/attachment`
 *    单请求通道（行为与改动前完全一致）。
 *
 * kind=attachment|music|video 决定后缀白名单与云盘开关（见 av-upload.ts），全部由后台配置驱动。
 *
 * 限流只挂在「真的要建 Graph 会话」那一步：探测本身不落任何东西，不该扣配额
 * （以前每次上传都白扣一次 attach-session，等于把 10 次/小时砍成 5 次）。
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json({ ok: false, error: "跨站请求被拒绝" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });

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

  // 去重：同一用户已上传过同名同大小的文件 → 直接复用已完成记录，跳过整轮上传
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
  if (!cloud) {
    // 无云盘时给出「本机流式直传」通道，否则才让调用方退回单请求通道
    if (target.stream)
      return NextResponse.json({
        ok: true,
        mode: "driver",
        uploadUrl: `/api/upload/attachment/stream?name=${encodeURIComponent(name)}&kind=${kind}`,
        maxBytes: target.maxBytes,
      });
    return NextResponse.json(
      { ok: false, code: "NO_CLOUD", error: "未启用活跃 OneDrive 云盘" },
      { status: 409 },
    );
  }

  // 到这一步才真的要建 Graph 会话，此时扣配额
  if (!(await rateLimit(`attach-session:${session.user.id}`, 10, 60 * 60_000)))
    return NextResponse.json({ ok: false, error: "上传过于频繁，请稍后再试" }, { status: 429 });

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
      // 分片大小由服务端下发、客户端跟随；必须是 320 KiB 的整数倍且 < 60 MiB（Graph 硬约束）
      chunkSize: GRAPH_CHUNK_BYTES,
    });
  } catch (e) {
    console.error("[upload-attachment-session]", e);
    return NextResponse.json({ ok: false, error: "创建 OneDrive 上传会话失败" }, { status: 502 });
  }
}
