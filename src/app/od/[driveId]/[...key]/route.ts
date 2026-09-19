import { NextResponse } from "next/server";
import { fetchDriveContent, getCloudDrive, resolveDriveDownloadUrl } from "@/lib/storage/onedrive";
import { avKindByExt, avMimeOf } from "@/lib/av";

// 云盘文件出口：把 /od/{driveId}/{itemPath} 存储引用解析为文件内容。
//
// 两条分支，按「这个文件要怎么被消费」分：
//   ① 音视频（mp3/mp4/…）→ **本站代理转发**，自己定 Content-Type 与 `Content-Disposition: inline`，
//      并把 Range 透传给 Graph。原因见下面 fetchDriveContent 的注释：Graph 的下载地址是
//      「下载」语义，直接 302 过去浏览器会存盘、`<video>` 也放不出来。
//   ② 其余（压缩包/文档等附件）→ 保持 302 跳到预鉴权下载地址，不占本站带宽。
//
// 文件本身与 /uploads 一样公开，路由只做解析不鉴权。

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// itemPath 段安全：路径由服务端生成，这里双保险——非空、≤120 字符、非 . / ..、
// 不含路径分隔与控制字符（保留原名后需放行中文/空格/括号等可读字符）。
const DRIVE_ID = /^[A-Za-z0-9]{5,64}$/;
function safeSeg(s: string): boolean {
  return (
    s.length > 0 &&
    s.length <= 120 &&
    s !== "." &&
    s !== ".." &&
    !/[\\/\u0000-\u001f\u007f]/.test(s)
  );
}

/** 从上游挑出与「字节范围」有关的响应头：漏了 Content-Range 浏览器会认为 206 不合法而放弃续播 */
const PASSTHROUGH = ["content-length", "content-range", "etag", "last-modified"] as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ driveId: string; key: string[] }> },
) {
  const { driveId, key } = await params;
  if (!DRIVE_ID.test(driveId ?? "") || !Array.isArray(key) || key.length === 0 || key.length > 24)
    return new NextResponse("bad request", { status: 400 });
  if (!key.every(safeSeg)) return new NextResponse("bad request", { status: 400 });

  let drive;
  try {
    drive = await getCloudDrive(driveId);
  } catch (e) {
    console.error("[od:get-drive]", e);
    return new NextResponse("storage error", { status: 500 });
  }
  if (!drive || !drive.enabled) return new NextResponse("not found", { status: 404 });

  const itemPath = key.join("/");

  // ---- ① 音视频：代理内联播放 ----
  const avKind = avKindByExt(itemPath);
  if (avKind) {
    let up: Response;
    try {
      up = await fetchDriveContent(drive, itemPath, req.headers.get("range"));
    } catch (e) {
      console.error("[od:content]", driveId, itemPath, e);
      return new NextResponse("proxy error", { status: 502 });
    }
    if (up.status === 404) return new NextResponse("not found", { status: 404 });
    if (!up.body || (!up.ok && up.status !== 206)) {
      await up.arrayBuffer().catch(() => {});
      console.error("[od:content]", driveId, itemPath, `HTTP ${up.status}`);
      return new NextResponse("proxy error", { status: 502 });
    }

    const headers = new Headers();
    // MIME 由本站按扩展名裁定：上游可能回 application/octet-stream，那会让 <video> 拒绝解码
    headers.set("Content-Type", avMimeOf(itemPath, avKind));
    headers.set("Content-Disposition", "inline");
    headers.set("Accept-Ranges", "bytes");
    for (const h of PASSTHROUGH) {
      const v = up.headers.get(h);
      if (v) headers.set(h, v);
    }
    // 引用里带 uuid、内容不再变，可放心让 CDN/浏览器缓存（拖动进度条靠 Range 而不是靠不缓存）
    headers.set("Cache-Control", "public, max-age=3600");
    return new Response(up.body, { status: up.status === 206 ? 206 : 200, headers });
  }

  // ---- ② 附件：保持 302，不转发字节 ----
  let dl: string | null;
  try {
    dl = await resolveDriveDownloadUrl(drive, itemPath);
  } catch (e) {
    console.error("[od:resolve]", driveId, itemPath, e);
    return new NextResponse("proxy error", { status: 502 });
  }
  if (!dl) return new NextResponse("not found", { status: 404 });

  return new NextResponse(null, {
    status: 302,
    headers: { Location: dl, "Cache-Control": "private, no-store" },
  });
}
