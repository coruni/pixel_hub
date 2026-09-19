import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { makeKey, saveStream, streamCapable } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/origin";
import { extFromName, parseUploadKind, rejectFile, resolveUploadTarget } from "@/lib/av-upload";

export const runtime = "nodejs";

/**
 * 流式直传：请求体就是文件原始字节（Content-Type: application/octet-stream），
 * 边收边落盘，**不把整个文件读进内存**。
 *
 * 为什么需要它：`/attachment` 那条通道走 `req.formData()`，请求体必须先整体读进内存才能
 * 拿到 File —— 所以它只能限在内存安全线上（250MB）。视频超 250MB 是常态，于是
 * 「后台配了 2GB 上限、界面也写 2GB，实际传个 300MB 就被拒」。
 *
 * 契约（与 Graph 分片通道对齐，客户端只换传输方式、不换判定）：
 *   - 名字/类型走 query：`?name=<文件名>&kind=attachment|music|video`
 *   - 体积先看 Content-Length（缺了就 411），再在落盘流里按累计字节数硬拦
 *   - 不支持流式的驱动（s3 / chevereto）返回 501 + `code: "NO_STREAM"`，
 *     调用方据此回退到 `/attachment` 单请求通道，行为与改动前一致
 *
 * 自托管部署注意：这条路径是长连接（GB 级要跑几分钟），反向代理的
 * `proxy_read_timeout` / `client_max_body_size` 要跟着放大，否则会被代理先掐断。
 */
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json({ ok: false, error: "跨站请求被拒绝" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  // 与 /attachment 共用同一个配额桶：一次上传只扣一次，换通道不额外收费
  if (!(await rateLimit(`attach:${session.user.id}`, 10, 60 * 60_000)))
    return NextResponse.json({ ok: false, error: "上传过于频繁，请稍后再试" }, { status: 429 });

  const sp = new URL(req.url).searchParams;
  const kind = parseUploadKind(sp.get("kind"));
  const name = (sp.get("name") ?? "").replace(/[\\/]/g, "_").slice(0, 120) || "file";
  const declared = Number(req.headers.get("content-length") ?? "");

  if (!streamCapable())
    return NextResponse.json(
      {
        ok: false,
        code: "NO_STREAM",
        error: "当前存储驱动不支持大文件流式上传，请改用 OneDrive 云盘或压缩文件体积",
      },
      { status: 501 },
    );
  if (!Number.isSafeInteger(declared) || declared <= 0)
    return NextResponse.json(
      { ok: false, error: "缺少文件大小（Content-Length），无法接收" },
      { status: 411 },
    );
  if (!req.body) return NextResponse.json({ ok: false, error: "未收到文件" }, { status: 400 });

  const target = await resolveUploadTarget(kind);
  const rejected = rejectFile(target, name, declared);
  if (rejected) return NextResponse.json({ ok: false, error: rejected }, { status: 400 });

  const fileName = name.slice(0, 120);
  // 去重与体积校验都排在读字节之前：命中重复时一个字节都不用传
  const dup = await prisma.media.findFirst({
    where: {
      kind: "ATTACHMENT",
      uploaderId: session.user.id,
      fileName,
      size: declared,
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

  try {
    const key = makeKey("files", `.${extFromName(name)}`);
    const saved = await saveStream(key, req.body, target.maxBytes);
    const media = await prisma.media.create({
      data: {
        kind: "ATTACHMENT",
        uploaderId: session.user.id,
        storageKey: saved.url,
        size: saved.size,
        mime: req.headers.get("content-type")?.slice(0, 120) || null,
        fileName,
        status: "READY",
      },
    });
    return NextResponse.json({ ok: true, id: media.id, url: saved.url, name, size: saved.size });
  } catch (e) {
    console.error("[upload-attachment-stream]", e);
    // 流里抛的「超限」是可归因的用户错误，别混进 500 的泛化文案里
    if (e instanceof Error && e.message.includes("超过允许的上限"))
      return NextResponse.json({ ok: false, error: rejectFile(target, name, declared) ?? "文件过大" }, { status: 413 });
    return NextResponse.json({ ok: false, error: "上传失败，请重试" }, { status: 500 });
  }
}
