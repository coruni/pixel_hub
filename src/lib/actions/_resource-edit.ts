// 资源改稿的字段解析 + 写库 + 标签同步（后台改稿与作者改稿共用，保证两套入口行为一致）。
// 本文件不加 "use server"——仅作为模块被各 action 内部调用。
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { articleMetaSchema, avMetaSchema, gameMetaSchema, imageMetaSchema } from "@/lib/meta";
import { randomTail, slugify } from "@/lib/slug";
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
  /** GAME 下载源清单（原始 JSON），下方统一落成版本记录 */
  let gameDownloads: unknown[] = [];
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
    const parsed = gameMetaSchema.safeParse({
      version: str(fd, "version") || undefined,
      platforms:
        str(fd, "platforms")
          .split(/[,，、\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8) || undefined,
      lang: str(fd, "lang") || undefined,
      note: str(fd, "note") || undefined,
    });
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    metaStr = JSON.stringify(parsed.data);
    const { value: downloads, error } = readDownloads(fd);
    if (error) return { fieldErrors: { downloads: [error] } };
    gameDownloads = downloads;
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

  // —— GAME 下载源清单 → 版本记录（发布侧同规则：一个下载源一条版本）——
  // 身份用 url 判定：改稿只做「新增未出现过的 url / 删掉已不在清单里的 url」，
  // 已存在的记录原样保留（连带保留其 downloadCount 与 createdAt），改个名字不会清空下载数。
  if (type === "GAME") {
    const list = gameDownloads
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .map((d) => ({
        name: String(d.name ?? "").trim(),
        url: String(d.url ?? "").trim(),
        // 手上没有版本号和更新日志（发布页已移除该字段），沿用资源元信息里的版本号作展示
        version: str(fd, "version") || "1.0",
      }))
      .filter((d) => d.url !== "");
    const desiredUrls = new Set(list.map((d) => d.url));
    // 兜底：清单为空时至少保留 externalUrl 一条，避免「有下载外链却没有可下载项」
    if (list.length === 0 && externalUrl) {
      list.push({ name: externalUrl, url: externalUrl, version: str(fd, "version") || "1.0" });
      desiredUrls.add(externalUrl);
    }
    // 不会被本清单删掉的记录：老数据里 url 为空的版本行（改稿页无法回填，保留原样）
    const keepRows = await tx.resourceVersion.findMany({
      where: { resourceId: id, OR: [{ url: null }, { url: "" }] },
      select: { id: true },
    });
    const keepIds = new Set(keepRows.map((v) => v.id));
    const existingVersions = await tx.resourceVersion.findMany({
      where: { resourceId: id },
      select: { id: true, url: true },
    });
    const existingUrls = new Set(existingVersions.map((v) => v.url).filter((u): u is string => !!u));

    for (const d of list) {
      if (existingUrls.has(d.url)) continue; // 已有同 url 记录 → 保留（含下载计数）
      await tx.resourceVersion.create({
        data: { resourceId: id, version: d.version, changelog: null, url: d.url },
      });
    }
    const staleIds = existingVersions
      .filter((v) => v.url && !desiredUrls.has(v.url) && !keepIds.has(v.id))
      .map((v) => v.id);
    if (staleIds.length > 0)
      await tx.resourceVersion.deleteMany({ where: { id: { in: staleIds }, resourceId: id } });
  }

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

  // 图集类（游戏 / 图片）必须留至少一张预览图；封面类（文章 / 音乐 / 视频）允许删空 ——
  // 封面是可选项（向导对这三类不标必填），删空后前台按无封面占位渲染（queries 里 cover 为 null）。
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
