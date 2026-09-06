"use server";

// 管理后台媒体库：全站媒体（Media 表）列表的删除 + 管理员直传，走统一存储层。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { adminOnly, audit, staff } from "@/lib/actions/_guards";
import { makeKey, saveFile, delFile, isStorageUrl } from "@/lib/storage";
import { deleteStoredCloudRef, parseCloudRef } from "@/lib/storage/onedrive";
import { MIB } from "@/lib/upload-config";
import { getUploadLimits } from "@/lib/upload-limits";

type MediaRow = {
  id: string;
  fileName: string | null;
  storageKey: string;
  thumbKey: string | null;
  bigKey: string | null;
};

/**
 * 逐条确认媒体可删：被资源（封面/图集）、评论或头像引用时拒绝，需先解除引用。
 * 头像引用是裸 key（不在 Media 表），单独比对一次。
 */
async function checkDeletable(
  mediaId: string,
): Promise<{ ok: true; media: MediaRow; keys: string[] } | { ok: false; reason: string }> {
  const m = await prisma.media.findUnique({
    where: { id: mediaId },
    include: { _count: { select: { coverOf: true } } },
  });
  if (!m) return { ok: false, reason: "媒体不存在" };
  if ((m._count.coverOf ?? 0) > 0 || !!m.resourceId || !!m.commentId)
    return { ok: false, reason: "正被内容引用（封面/图集/评论）" };

  const keys = [m.storageKey, m.thumbKey, m.bigKey].filter((k): k is string => !!k);
  const avatarUser = await prisma.user.findFirst({
    where: { avatarKey: { in: keys } },
    select: { id: true },
  });
  if (avatarUser) return { ok: false, reason: "正被用户用作头像" };
  return { ok: true, media: m, keys };
}

/** 删存储文件：云附件引用走 Graph，其余走统一存储层（local 驱动不接受带前导斜杠的路径） */
async function purgeFiles(keys: string[]): Promise<void> {
  for (const k of keys) {
    if (parseCloudRef(k)) {
      await deleteStoredCloudRef(k);
    } else {
      await delFile(isStorageUrl(k) ? k : k.replace(/^\/+/, "")).catch(() => {});
    }
  }
}

/** 删除媒体：被资源（封面/图集/评论图）或头像引用时拒绝，需先解除引用 */
export async function deleteMediaAction(mediaId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await staff();
  if (!me) return { ok: false, error: "无权限" };

  const check = await checkDeletable(mediaId);
  if (!check.ok) return { ok: false, error: check.reason };

  await prisma.media.delete({ where: { id: mediaId } });
  await audit(me.id, "DELETE_MEDIA", "MEDIA", mediaId, check.media.fileName ?? undefined);
  await purgeFiles(check.keys);
  revalidatePath("/admin/media");
  return { ok: true };
}

export type BulkMediaResult = {
  ok: boolean;
  error?: string;
  deleted?: number;
  skipped?: { id: string; reason: string }[];
};

const MAX_BULK = 200;

/**
 * 孤儿媒体批量清理（仅 ADMIN）：服务端对每条重新确认未关联资源/评论/头像才删，
 * 不信任客户端传来的「孤儿」判定；被引用或非法 ID 一律跳过并原样返回原因。
 */
export async function bulkDeleteOrphanMediaAction(ids: string[]): Promise<BulkMediaResult> {
  const me = await adminOnly();
  if (!me) return { ok: false, error: "仅管理员可批量清理" };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "请先选择要清理的媒体" };

  const unique = [
    ...new Set(ids.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 40)),
  ].slice(0, MAX_BULK);
  if (unique.length === 0) return { ok: false, error: "请先选择要清理的媒体" };
  if (unique.length !== ids.length)
    return { ok: false, error: `单次最多清理 ${MAX_BULK} 条，且不能重复` };

  const skipped: { id: string; reason: string }[] = [];
  let deleted = 0;
  for (const id of unique) {
    const check = await checkDeletable(id);
    if (!check.ok) {
      skipped.push({ id, reason: check.reason });
      continue;
    }
    await prisma.media.delete({ where: { id } });
    await purgeFiles(check.keys);
    deleted++;
  }

  await audit(
    me.id,
    "DELETE_MEDIA_BULK",
    "MEDIA",
    undefined,
    `删除 ${deleted} 条，跳过 ${skipped.length} 条`,
  );
  revalidatePath("/admin/media");
  return { ok: true, deleted, skipped };
}

function sniffImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  const s = (str: string, off: number) =>
    buf.subarray(off, off + str.length).toString("latin1") === str;
  if (s("RIFF", 0) && s("WEBP", 8)) return true;
  if (s("GIF8", 0)) return true;
  return false;
}

/** 管理员直传：原图直存统一存储层，落 Media 记录（不关联资源）。上限跟随后台图集/原图档配置 */
export async function uploadMediaAction(
  _prev: { ok?: boolean; error?: string },
  fd: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const me = await staff();
  if (me?.role !== "ADMIN") return { error: "仅管理员可直传" };

  const L = await getUploadLimits();
  const maxBytes = L.galleryImageMaxMb * MIB;

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "请选择文件" };
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > maxBytes) return { error: `文件不能超过 ${L.galleryImageMaxMb}MB` };
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
