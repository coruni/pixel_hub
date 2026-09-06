// 资源改稿的字段解析 + 写库 + 标签同步（后台改稿与作者改稿共用，保证两套入口行为一致）。
// 本文件不加 "use server"——仅作为模块被各 action 内部调用。
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { articleMetaSchema, gameMetaSchema, imageMetaSchema } from "@/lib/meta";
import { randomTail, slugify } from "@/lib/slug";
import { MAX_TAGS, resourceTextFields } from "@/lib/resource-fields";

export type ResourceEditState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

const baseSchema = resourceTextFields.extend({
  id: z.string().min(1, "缺少资源"),
});

function on(fd: FormData, key: string): boolean {
  return fd.get(key) === "on";
}

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** 读取各分节受控序列化的 downloads JSON（IMAGE 多附件图包 / ARTICLE 文末清单同源） */
function readDownloads(fd: FormData): { value: unknown[]; error?: string } {
  try {
    const v = JSON.parse(str(fd, "downloads") || "[]");
    return { value: Array.isArray(v) ? v : [] };
  } catch {
    return { value: [], error: "附件清单格式不正确" };
  }
}

/**
 * 在事务内应用一次资源改稿。调用方负责权限校验（staff / 作者）与外层 revalidate。
 * actorId 用于认领改稿时新上传的孤儿媒体（仅本人上传、尚未归属的才可认领，防 IDOR 抢他人素材）。
 * 返回 fieldErrors 表示字段校验失败；空对象表示成功。
 */
export async function applyResourceEdit(
  tx: Prisma.TransactionClient,
  id: string,
  type: "GAME" | "IMAGE" | "ARTICLE",
  fd: FormData,
  actorId: string,
): Promise<{ fieldErrors?: Record<string, string[]> }> {
  const base = baseSchema.safeParse({
    id,
    title: str(fd, "title"),
    summary: str(fd, "summary"),
    description: str(fd, "description"),
    categoryId: str(fd, "categoryId"),
    tags: str(fd, "tags"),
    externalUrl: str(fd, "externalUrl"),
  });
  if (!base.success) return { fieldErrors: base.error.flatten().fieldErrors };
  const { title, summary, description, categoryId, tags, externalUrl } = base.data;

  const category = await tx.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!category) return { fieldErrors: { categoryId: ["分类不存在"] } };

  // —— 类型化 meta（复用发布侧的 zod schema，保证写库形状一致）——
  const license = str(fd, "license");
  let metaStr: string | undefined;
  if (type === "IMAGE") {
    const { value: downloads, error } = readDownloads(fd);
    if (error) return { fieldErrors: { downloads: [error] } };
    const parsed = imageMetaSchema.safeParse({
      isAiGenerated: on(fd, "isAiGenerated"),
      aiTool: str(fd, "aiTool") || undefined,
      aiModel: str(fd, "aiModel") || undefined,
      original: on(fd, "original"),
      license,
      sourceNote: str(fd, "sourceNote") || undefined,
      downloads,
    });
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    metaStr = JSON.stringify(parsed.data);
  } else if (type === "ARTICLE") {
    const { value: downloads, error } = readDownloads(fd);
    if (error) return { fieldErrors: { downloads: [error] } };
    const parsed = articleMetaSchema.safeParse({ license, downloads });
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    metaStr = JSON.stringify(parsed.data);
  } else {
    const parsed = gameMetaSchema.safeParse({
      version: str(fd, "version") || undefined,
      size: str(fd, "size") || undefined,
      platforms:
        str(fd, "platforms")
          .split(/[,，、\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8) || undefined,
      lang: str(fd, "lang") || undefined,
      license,
      note: str(fd, "note") || undefined,
    });
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    metaStr = JSON.stringify(parsed.data);
  }

  await tx.resource.update({
    where: { id },
    data: {
      title,
      summary: summary || null,
      description,
      categoryId,
      meta: metaStr,
      // 外链下载语义只属于 GAME（版本表/externalUrl 驱动下载按钮）；其余类型保持原值
      ...(type === "GAME" ? { externalUrl: externalUrl || null } : {}),
      nsfw: on(fd, "nsfw"),
      loginRequired: on(fd, "loginRequired"),
      allowComments: on(fd, "allowComments"),
      isDownloadable: on(fd, "isDownloadable"),
    },
  });

  // 标签同步：只动差异部分，并同步 Tag.count（保留的不重复计数，移除的递减）
  const existing = await tx.tagOnResource.findMany({
    where: { resourceId: id },
    include: { tag: { select: { id: true, name: true } } },
  });
  const desired = [
    ...new Set(
      tags
        .split(/[,，、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_TAGS);
  const keep = new Set(desired);

  for (const link of existing) {
    if (keep.has(link.tag.name)) continue;
    await tx.tagOnResource.delete({
      where: { resourceId_tagId: { resourceId: id, tagId: link.tagId } },
    });
    await tx.tag
      .update({ where: { id: link.tagId }, data: { count: { decrement: 1 } } })
      .catch(() => undefined);
  }

  const have = new Set(existing.filter((l) => keep.has(l.tag.name)).map((l) => l.tag.name));
  for (const name of desired) {
    if (have.has(name)) continue;
    const tag =
      (await tx.tag.findUnique({ where: { name } })) ??
      (await tx.tag
        .create({ data: { name, slug: slugify(name) || `tag-${randomTail()}` } })
        .catch(() => tx.tag.findUnique({ where: { name } })));
    if (!tag) continue;
    const link = await tx.tagOnResource
      .create({ data: { resourceId: id, tagId: tag.id } })
      .catch(() => null);
    if (link) await tx.tag.update({ where: { id: tag.id }, data: { count: { increment: 1 } } });
  }

  // —— 媒体：认领新上传、移除被删、重排、设封面（复用发布侧的防 IDOR 认领规则）——
  let mediaIds: string[] = [];
  try {
    const parsed = JSON.parse(String(fd.get("mediaIds") ?? "[]"));
    mediaIds = Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    mediaIds = [];
  }
  const coverRaw = String(fd.get("coverId") ?? "").trim();

  // 非文章类型至少保留一张图（与发布一致）
  if (type !== "ARTICLE" && mediaIds.length === 0)
    return { fieldErrors: { mediaIds: ["请至少保留一张图片"] } };

  const existingMedia = await tx.media.findMany({
    where: { resourceId: id },
    select: { id: true },
  });
  const existingIds = new Set(existingMedia.map((m) => m.id));

  // 认领改稿时新上传的孤儿媒体：仅本人上传、尚未归属其他内容/评论的才可认领
  const newIds = mediaIds.filter((mid) => !existingIds.has(mid));
  if (newIds.length > 0) {
    await tx.media.updateMany({
      where: { id: { in: newIds }, uploaderId: actorId, resourceId: null, commentId: null },
      data: { resourceId: id },
    });
  }
  // 移除不再引用的媒体：置为孤儿（保留行，由清理逻辑回收），不物理删除
  const removedIds = existingMedia.map((m) => m.id).filter((mid) => !mediaIds.includes(mid));
  if (removedIds.length > 0) {
    await tx.media.updateMany({
      where: { id: { in: removedIds }, resourceId: id },
      data: { resourceId: null },
    });
  }
  // 按最终顺序重排；where 带 resourceId 限定，确保只动本资源媒体（避免恶意 id 串改他人素材）
  for (let i = 0; i < mediaIds.length; i++) {
    await tx.media
      .update({ where: { id: mediaIds[i], resourceId: id }, data: { sort: i } })
      .catch(() => undefined);
  }
  const finalCover = mediaIds.includes(coverRaw) ? coverRaw : (mediaIds[0] ?? null);
  await tx.resource.update({ where: { id }, data: { coverMediaId: finalCover || null } });

  return {};
}
