import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { makeKey, saveFile } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/origin";

export const runtime = "nodejs";

// 附件直传：任意分发格式（压缩包/文档等），单文件 ≤200MB，走统一存储层。
// 落 Media(kind=ATTACHMENT) 记录；返回的 url 供发布时填 externalUrl / 版本 url。
const MAX_BYTES = 200 * 1024 * 1024;

// 扩展名白名单（不信任客户端 mime，按文件名扩展判断；可执行文件禁止）
const ALLOWED_EXT = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
  "pdf",
  "md",
  "txt",
  "epub",
  "mobi",
  "mp3",
  "wav",
  "ogg",
  "flac",
  "mp4",
  "webm",
  "mkv",
  "obj",
  "fbx",
  "blend",
  "aseprite",
  "godot",
  "unitypackage",
  "ttf",
  "otf",
  "woff",
  "woff2",
]);

export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json({ ok: false, error: "跨站请求被拒绝" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  // 附件体积大（≤200MB）：比图片更紧的限流，防存储滥用
  if (!rateLimit(`attach:${session.user.id}`, 10, 60 * 60_000))
    return NextResponse.json({ ok: false, error: "上传过于频繁，请稍后再试" }, { status: 429 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "未收到文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "文件不能超过 200MB" }, { status: 400 });
  }

  const name = (file.name || "file").replace(/[\\/]/g, "_");
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json(
      { ok: false, error: `不支持的附件格式（.${ext || "?"}）` },
      { status: 400 },
    );
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const key = makeKey("files", `.${ext}`);
    const url = await saveFile(key, buf);
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
