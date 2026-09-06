import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { sameOrigin } from "@/lib/origin";
import {
  getCloudDrive,
  makeCloudRef,
  readDriveUploadTicket,
  recordDriveError,
  recordDriveOk,
  verifyDriveUpload,
} from "@/lib/storage/onedrive";

export const runtime = "nodejs";

/** 只确认 Graph 文件已完成并创建 Media 记录，不接收文件内容。 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json({ ok: false, error: "跨站请求被拒绝" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ticket?: unknown } | null;
  if (typeof body?.ticket !== "string")
    return NextResponse.json({ ok: false, error: "上传会话无效" }, { status: 400 });

  try {
    const ticket = readDriveUploadTicket(body.ticket, session.user.id);
    const drive = await getCloudDrive(ticket.driveId);
    if (!drive)
      return NextResponse.json({ ok: false, error: "OneDrive 云盘不存在" }, { status: 404 });

    await verifyDriveUpload(drive, ticket.itemPath, ticket.size);
    const url = makeCloudRef(drive.id, ticket.itemPath);
    const existing = await prisma.media.findFirst({ where: { storageKey: url } });
    const media =
      existing ??
      (await prisma.media.create({
        data: {
          kind: "ATTACHMENT",
          uploaderId: session.user.id,
          storageKey: url,
          size: ticket.size,
          mime: ticket.mime,
          fileName: ticket.name,
          status: "READY",
        },
      }));
    await recordDriveOk(drive.id);
    return NextResponse.json({ ok: true, id: media.id, url, name: ticket.name, size: ticket.size });
  } catch (e) {
    const message = e instanceof Error ? e.message : "上传确认失败";
    console.error("[upload-attachment-complete]", e);
    const ticket = typeof body?.ticket === "string" ? body.ticket : "";
    if (ticket) {
      try {
        const parsed = readDriveUploadTicket(ticket, session.user.id);
        await recordDriveError(parsed.driveId, message);
      } catch {
        // 凭证本身无效时不再重复处理
      }
    }
    const status =
      typeof e === "object" && e && "status" in e && typeof e.status === "number" ? e.status : 502;
    return NextResponse.json(
      { ok: false, error: status >= 400 && status < 500 ? message : "上传确认失败，请重试" },
      { status },
    );
  }
}
