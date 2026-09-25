// 资源改稿的字段解析 + 写库 + 标签同步（后台改稿与作者改稿共用，保证两套入口行为一致）。
// 本文件不加 "use server"——仅作为模块被各 action 内部调用。
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { articleMetaSchema, avMetaSchema, gameMetaSchema, imageMetaSchema } from "@/lib/meta";
import { asciiSlug, randomTail } from "@/lib/slug";
import { MAX_TAGS, resourceTextFields, urlLike } from "@/lib/resource-fields";
import { ARTICLE_MEDIA_MAX, isSingleCoverType } from "@/lib/upload-config";
import { TYPE_LABEL } from "@/lib/display";

/** 资源类型（与 Prisma ResourceType 一致）；改稿按类型决定 meta 形状 */
export type EditableResourceType = "GAME" | "IMAGE" | "ARTICLE" | "MUSIC" | "VIDEO";

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

/** 读取各分节受控序列化的 downloads JSON（IMAGE 多附件图包 / ARTICLE 文末清单 / GAME 下载源同源） */
function readDownloads(fd: FormData): { value: unknown[]; error?: string } {
  try {
    const v = JSON.parse(str(fd, "downloads") || "[]");
    return { value: Array.isArray(v) ? v : [] };
  } catch {
    return { value: [], error: "附件清单格式不正确" };
  }
}

/** 取清单里第一条有效 url（GAME 的 externalUrl 由它推导） */
function firstUrl(list: unknown[]): string {
  for (const d of list) {
    if (!d || typeof d !== "object") continue;
    const u = String((d as { url?: unknown }).url ?? "").trim();
    if (u && urlLike(u)) return u;
  }
  return "";
}

/**
 * 在事务内应用一次资源改稿。调用方负责权限校验（staff / 作者）与外层 revalidate。
 * actorId 用于认领改稿时新上传的孤儿媒体（仅本人上传、尚未归属的才可认领，防 IDOR 抢他人素材）。
 * 返回 fieldErrors 表示字段校验失败；空对象表示成功。
 */
export async function applyResourceEdit(
  tx: Prisma.TransactionClient,
  id: string,
  type: EditableResourceType,
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
  const { title, summary, description, categoryId, tags } = base.data;
  /** GAME 主下载地址：默认取表单值，随后被下载源清单首条覆盖 */
  let externalUrl = base.data.externalUrl;

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
  } else if (type === "MUSIC" || type === "VIDEO") {
    // 音视频改稿：与发布侧同一套 schema（source/mode/url + 类型补充字段 + 下载清单）
    const { value: downloads, error } = readDownloads(fd);
    if (error) return { fieldErrors: { downloads: [error] } };
    const parsed = avMetaSchema.safeParse({
      source: str(fd, "avSource") === "file" ? "file" : "mount",
      mode: str(fd, "avMode") === "embed" ? "embed" : "direct",
      url: str(fd, "avUrl"),
      artist: str(fd, "artist") || undefined,
      duration: str(fd, "duration") || undefined,
      resolution: str(fd, "resolution") || undefined,
      downloads,
    });
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    metaStr = JSON.stringify(parsed.data);
  } else {
    const { value: downloads, error } = readDownloads(fd);
    if (error) return { fieldErrors: { downloads: [error] } };
    // GAME 无版本概念：下载源清单直接存进 meta.downloads（不再写 ResourceVersion 表）。
    // 详情页「游戏下载」与改稿回填都读这一处，downloadCount 走资源级 detail.downloadCount。
    const parsed = gameMetaSchema.safeParse({
      platforms:
        str(fd, "platforms")
          .split(/[,，、\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8) || undefined,
      lang: str(fd, "lang") || undefined,
      note: str(fd, "note") || undefined,
      downloads,
    });
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    metaStr = JSON.stringify(parsed.data);
    // 发布页已移除独立的「下载外链」输入，主下载地址改为取清单首条有效 url；
    // 清单为空时退回表单里的 externalUrl（兼容外部 API 只传外链的调用）。
    externalUrl = firstUrl(downloads) || externalUrl;
  }

  // GAME 必填至少一条有效下载源（与发布侧同一规则）
  if (type === "GAME" && !externalUrl)
    return { fieldErrors: { downloads: ["请至少保留一条有效的下载地址（http(s):// 或站内附件路径）"] } };

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
    },
  });

  // GAME 的下载源清单已存进 meta.downloads（见上方分支），不再写 ResourceVersion 表。
  // 这张表对 GAME 不再有任何读写，历史上灌进去的记录由迁移脚本清理。

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
  // 这里只做同步的 asciiSlug（汉字→拼音），**不发翻译请求** —— 本函数整体跑在调用方的 DB 事务里，
  // 逐条翻译可能各等数秒超时，会把事务挂住。改稿新建的标签用拼音 slug，后续发布同名标签时
  // 发布侧的 `findUnique({ where: { name } })` 兜底会命中并复用，不会产生同名词条。
  for (const name of desired) {
    if (have.has(name)) continue;
    const tag =
      (await tx.tag.findUnique({ where: { name } })) ??
      (await tx.tag
        .create({ data: { name, slug: asciiSlug(name) || `tag-${randomTail()}` } })
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

  // IMAGE 保留预览图组；游戏 / 文章 / 音乐 / 视频只保留一张封面，并允许删空 ——
  // 封面是可选项（向导对这些类型不标必填），删空后前台按无封面占位渲染（queries 里 cover 为 null）。
  // 若把封面类也要求非空，就会出现「封面删不掉」：点 X 移除后保存被这里挡回。
  if (!isSingleCoverType(type) && mediaIds.length === 0)
    return { fieldErrors: { mediaIds: ["请至少保留一张图片"] } };
  if (isSingleCoverType(type) && mediaIds.length > ARTICLE_MEDIA_MAX)
    return {
      fieldErrors: {
        mediaIds: [
          `${TYPE_LABEL[type] ?? "该类型"}只需 ${ARTICLE_MEDIA_MAX} 张封面图，其余插图放正文里`,
        ],
      },
    };

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
