import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { makeKey, saveFile } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/origin";
import {
  cloudItemPathFor,
  makeCloudRef,
  recordDriveError,
  recordDriveOk,
  uploadDriveFile,
} from "@/lib/storage/onedrive";
import { MIB } from "@/lib/upload-config";
import { extFromName, parseUploadKind, rejectFile, resolveUploadTarget } from "@/lib/av-upload";

export const runtime = "nodejs";

/**
 * 缓冲通道的内存安全线。
 *
 * 这条通道走 `req.formData()` + `arrayBuffer()`，**整个文件必须先进内存**才能拿到 File，
 * 所以它的上限与宿主平台无关，只取决于进程能给多少堆：一个 2GB 的请求体会先在
 * `formData()` 里把内存吃光，压根走不到后面的体积校验。
 *
 * 大文件一律走 `/attachment/stream`（边收边落盘，上限就是后台配的 attachmentMaxMb，
 * 本地存储实测 300MB/4.2s）——客户端由 `/session` 的 `mode: "driver"` 自动改道。
 * 这里保留一个上限只是为了「不支持流式的驱动（s3 / chevereto）」和旧客户端不把进程撑爆。
 */
const BUFFERED_MAX_BYTES = 250 * MIB;

// 文件直传：任意分发格式（压缩包/文档）与音视频来源文件（kind=music|video）。
// 单文件上限与允许后缀由后台配置决定（见 av-upload.ts / getUploadLimits）；
// 落 Media(kind=ATTACHMENT) 记录；返回的 url 供发布时填 externalUrl / 版本 url / meta.url。

export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json({ ok: false, error: "跨站请求被拒绝" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  // 体积大（≤后台配置上限）：比图片更紧的限流，防存储滥用
  if (!(await rateLimit(`attach:${session.user.id}`, 10, 60 * 60_000)))
    return NextResponse.json({ ok: false, error: "上传过于频繁，请稍后再试" }, { status: 429 });

  // 先看 Content-Length 再解析：`req.formData()` 会把整个请求体读进内存才能拿到 File，
  // 超限的请求必须在这里就挡住，否则一个 2GB 的请求体会先把进程内存吃光再去判上限。
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isSafeInteger(declared) && declared > BUFFERED_MAX_BYTES)
    return NextResponse.json(
      {
        ok: false,
        code: "USE_UPLOAD_SESSION",
        error: "文件过大，请改用流式直传通道（刷新页面后会自动启用）",
      },
      { status: 413 },
    );

  const form = await req.formData();
  const kind = parseUploadKind(form.get("kind"));
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "未收到文件" }, { status: 400 });
  }

  const target = await resolveUploadTarget(kind);
  const rejected = rejectFile(target, file.name || "file", file.size);
  if (rejected) return NextResponse.json({ ok: false, error: rejected }, { status: 400 });
  // 走到这里说明该文件已整个进了内存（formData 的代价），再判一次安全线
  if (file.size > BUFFERED_MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        code: target.cloud || target.stream ? "USE_UPLOAD_SESSION" : "STORAGE_LIMIT",
        error:
          target.cloud || target.stream
            ? "大文件请改用流式直传通道"
            : "当前存储驱动不支持大文件流式上传，请压缩体积或启用 OneDrive 云盘",
      },
      { status: 413 },
    );
  }

  const name = (file.name || "file").replace(/[\\/]/g, "_");
  const ext = extFromName(name);

  // 去重：同一用户已上传过同名同大小的文件 → 直接复用已完成记录（与 session 路径一致）
  const fileName = name.slice(0, 120);
  const dup = await prisma.media.findFirst({
    where: {
      kind: "ATTACHMENT",
      uploaderId: session.user.id,
      fileName,
      size: file.size,
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
    const buf = Buffer.from(await file.arrayBuffer());

    // 云盘：Graph 已配置、后台开关允许且有活跃盘 → 写云盘并返回自描述引用 /od/{driveId}/{itemPath}；
    // 否则原样走统一存储层（local/s3/chevereto）。配置了云盘但上传失败 → 显式 500 + 记 lastError，不静默回退。
    let url: string;
    try {
      if (target.cloud) {
        // 落盘名 = 原名_uuid（原名供下载直接使用，uuid 防重复/并发覆盖）
        const itemPath = cloudItemPathFor(target.cloud, name);
        await uploadDriveFile(target.cloud, itemPath, buf);
        url = makeCloudRef(target.cloud.id, itemPath);
        await recordDriveOk(target.cloud.id).catch(() => {});
      } else {
        const key = makeKey("files", `.${ext}`);
        // 附件类型五花八门（压缩包/音视频/文档），key 扩展名说不清时以客户端声明为准；
        // 驱动侧会过滤 text/html、svg 这类可执行文档类型，不信任客户端原样写入。
        url = await saveFile(key, buf, file.type || undefined);
      }
    } catch (e) {
      if (target.cloud)
        await recordDriveError(target.cloud.id, (e as Error).message).catch(() => {});
      throw e;
    }

    const media = await prisma.media.create({
      data: {
        kind: "ATTACHMENT",
        uploaderId: session.user.id,
        storageKey: url,
        size: buf.byteLength,
        mime: file.type || null,
        fileName,
        status: "READY",
      },
    });
    return NextResponse.json({ ok: true, id: media.id, url, name, size: buf.byteLength });
  } catch (e) {
    console.error("[upload-attachment]", e);
    return NextResponse.json({ ok: false, error: "上传失败，请重试" }, { status: 500 });
  }
}
