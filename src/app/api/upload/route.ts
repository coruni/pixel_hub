import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { processImage, publicUrl } from "@/lib/media/process";
import { compressConfigOf } from "@/lib/media/compress";
import { rateLimit } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/origin";
import { MIB } from "@/lib/upload-config";
import { getUploadLimits } from "@/lib/upload-limits";

export const runtime = "nodejs";

import { COUNT_RANGE } from "@/lib/upload-config";

// 服务端魔数嗅探 + 扩展名白名单（不信任客户端 mime）
function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  const a = (s: string, off: number) => buf.subarray(off, off + s.length).toString("latin1") === s;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: "image/png", ext: "png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { mime: "image/jpeg", ext: "jpg" };
  if (a("RIFF", 0) && a("WEBP", 8)) return { mime: "image/webp", ext: "webp" };
  if (a("GIF8", 0)) return { mime: "image/gif", ext: "gif" };
  if (a("ftyp", 4)) return { mime: "image/avif", ext: "avif" };
  return null;
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json({ ok: false, error: "跨站请求被拒绝" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  // 上传限流：Chevereto 上传接口一次仅接受单文件，前端已改为逐张请求，
  // 因此按「请求」计费会随图片张数倍增，配额按张放宽到 120 次/小时（防滥用存储）。
  if (!(await rateLimit(`upload:${session.user.id}`, 120, 60 * 60_000)))
    return NextResponse.json({ ok: false, error: "上传过于频繁，请稍后再试" }, { status: 429 });

  // 单张上限以后台 /admin/uploads 配置为准（缺失回退默认 20MB）
  const L = await getUploadLimits();
  const maxBytes = L.galleryImageMaxMb * MIB;

  // 单次上传张数上限：优先取客户端（向导按类型传入）的 max 参数，并钳制在合法范围，
  // 缺失/越界时回退后台 galleryImageMaxCount；这是上传入口的安全网，最终上限由发布 action 强制。
  const maxParam = Number(req.nextUrl.searchParams.get("max"));
  const MAX_FILES =
    Number.isFinite(maxParam) && maxParam >= COUNT_RANGE.min && maxParam <= COUNT_RANGE.max
      ? Math.floor(maxParam)
      : L.galleryImageMaxCount;

  const form = await req.formData();
  const entries = form.getAll("files").filter((f): f is File => f instanceof File);
  if (entries.length === 0)
    return NextResponse.json({ ok: false, error: "未收到文件" }, { status: 400 });
  if (entries.length > MAX_FILES)
    return NextResponse.json({ ok: false, error: `单次最多上传 ${MAX_FILES} 张` }, { status: 400 });

  const results: unknown[] = [];
  for (const file of entries) {
    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name || "image";
    try {
      if (buf.byteLength > maxBytes) {
        console.warn(`[upload] 超大小被拒 userId=${session.user.id} fileName=${name} bytes=${buf.byteLength}`);
        results.push({ name, ok: false, error: `超过 ${L.galleryImageMaxMb}MB 限制` });
        continue;
      }
      const sniffed = sniff(buf);
      if (!sniffed) {
        console.warn(`[upload] 非图片格式被拒 userId=${session.user.id} fileName=${name}`);
        results.push({ name, ok: false, error: "不支持的图片格式（仅 png/jpg/webp/gif/avif）" });
        continue;
      }
      const p = await processImage(buf, compressConfigOf(L));
      const media = await prisma.media.create({
        data: {
          kind: "GALLERY",
          uploaderId: session.user.id,
          storageKey: p.storageKey,
          bigKey: p.bigKey,
          thumbKey: p.thumbKey,
          placeholder: p.placeholder,
          width: p.width,
          height: p.height,
          size: p.size,
          mime: p.mime,
          fileName: `${name.replace(/[\\/]/g, "_")}.${p.ext}`,
          status: "READY",
        },
      });
      results.push({
        id: media.id,
        ok: true,
        name,
        thumbUrl: media.thumbKey ? publicUrl(media.thumbKey) : null,
        bigUrl: media.bigKey ? publicUrl(media.bigKey) : null,
        origUrl: publicUrl(media.storageKey),
        width: p.width,
        height: p.height,
        placeholder: p.placeholder,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[upload] 失败 userId=${session.user.id} fileName=${name}`, reason, e);
      results.push({ name, ok: false, error: "图片处理失败，请重试或更换图片" });
    }
  }
  return NextResponse.json({ ok: true, files: results });
}
