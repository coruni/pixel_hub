"use server";

// 管理后台媒体库：全站媒体（Media 表）列表的删除 + 管理员直传，走统一存储层。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { audit, staff } from "@/lib/actions/_guards";
import { makeKey, saveFile, delFile, isStorageUrl } from "@/lib/storage";

/** 删除媒体：被资源（封面/图集/评论图）或头像引用时拒绝，需先解除引用 */
export async function deleteMediaAction(mediaId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await staff();
  if (!me) return { ok: false, error: "无权限" };

  const m = await prisma.media.findUnique({
    where: { id: mediaId },
    include: { _count: { select: { coverOf: true } } },
  });
  if (!m) return { ok: false, error: "媒体不存在" };

  const used =
    (m._count.coverOf ?? 0) > 0 || // 某资源封面
    !!m.resourceId || // 图集成员
    !!m.commentId; // 评论附图
  if (used) return { ok: false, error: "该图片正被内容引用（封面/图集/评论），请先在对应内容中移除" };

  // 头像引用是裸 key（不在 Media 表），删除前单独校验
  const keys = [m.storageKey, m.thumbKey, m.bigKey].filter((k): k is string => !!k);
  const avatarUser = await prisma.user.findFirst({ where: { avatarKey: { in: keys } }, select: { id: true } });
  if (avatarUser) return { ok: false, error: "该图片正被用户用作头像" };

  await prisma.media.delete({ where: { id: mediaId } });
  await audit(me.id, "DELETE_MEDIA", "MEDIA", mediaId, m.fileName ?? undefined);
  // local 驱动的 del 不接受带前导斜杠的路径（越界校验），相对 key 先剥掉
  for (const k of keys) await delFile(isStorageUrl(k) ? k : k.replace(/^\/+/, "")).catch(() => {});
  revalidatePath("/admin/media");
  return { ok: true };
}

const UPLOAD_MAX = 20 * 1024 * 1024;

function sniffImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  const s = (str: string, off: number) => buf.subarray(off, off + str.length).toString("latin1") === str;
  if (s("RIFF", 0) && s("WEBP", 8)) return true;
  if (s("GIF8", 0)) return true;
  return false;
}

/** 管理员直传：原图直存统一存储层，落 Media 记录（不关联资源） */
export async function uploadMediaAction(_prev: { ok?: boolean; error?: string }, fd: FormData): Promise<{ ok?: boolean; error?: string }> {
  const me = await staff();
  if (me?.role !== "ADMIN") return { error: "仅管理员可直传" };

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "请选择文件" };
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > UPLOAD_MAX) return { error: "文件不能超过 20MB" };
  if (!sniffImage(buf)) return { error: "仅支持 png/jpg/webp/gif 图片" };

  const ext = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
  const key = makeKey("uploads", ext || ".bin");
  try {
    const url = await saveFile(key, buf);
    await prisma.media.create({
      data: {
        kind: "ORIGINAL",
        uploaderId: me.id,
        storageKey: url, // chevereto 返回远端 URL，local/s3 返回站内路径
        size: buf.byteLength,
        mime: file.type || null,
        fileName: file.name.slice(0, 120),
        status: "READY",
      },
    });
    revalidatePath("/admin/media");
    return { ok: true };
  } catch (e) {
    console.error("[admin-media]", e);
    return { error: "上传失败，请重试" };
  }
}
