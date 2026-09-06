import { NextResponse } from "next/server";
import { getCloudDrive, resolveDriveDownloadUrl } from "@/lib/storage/onedrive";

// 附件下载网关：把 /od/{driveId}/{itemPath} 存储引用实时解析为 Graph 预鉴权下载 URL 后 307 跳转。
// 本站不缓冲/转发大文件字节；CDN 链接短时效，因此每次点击都实时查一次（轻量、正确）。
// 文件本身与现状 /uploads 一样公开，路由只做解析不鉴权。

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// itemPath 段安全：字母/数字/._-（构建时即受限，这里双保险防 .. 与注入）
const SEG = /^[A-Za-z0-9._-]{1,120}$/;
const DRIVE_ID = /^[A-Za-z0-9]{5,64}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ driveId: string; key: string[] }> },
) {
  const { driveId, key } = await params;
  if (!DRIVE_ID.test(driveId ?? "") || !Array.isArray(key) || key.length === 0 || key.length > 24)
    return new NextResponse("bad request", { status: 400 });
  if (!key.every((s) => SEG.test(s))) return new NextResponse("bad request", { status: 400 });

  let drive;
  try {
    drive = await getCloudDrive(driveId);
  } catch (e) {
    console.error("[od:get-drive]", e);
    return new NextResponse("storage error", { status: 500 });
  }
  if (!drive || !drive.enabled) return new NextResponse("not found", { status: 404 });

  const itemPath = key.join("/");
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
