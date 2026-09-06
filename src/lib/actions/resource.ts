"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { imageMetaSchema, gameMetaSchema, articleMetaSchema } from "@/lib/meta";
import { randomTail, uniqueSlug, slugify } from "@/lib/slug";
import { translateToEnglish } from "@/lib/edge-translate";
import { revalidatePath } from "next/cache";

export type ResourceActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  ok?: boolean;
  pending?: boolean; // 已进入审核队列
  resourceId?: string;
};

// 发布/改稿前确认账号未封禁（封禁用户写操作统一拦截）
async function activeUser() {
  const u = (await auth())?.user;
  if (!u) return null;
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { bannedAt: true } });
  if (!row || row.bannedAt) return null;
  return u;
}

const commonFields = z.object({
  type: z.enum(["GAME", "IMAGE", "ARTICLE"]),
  title: z.string().trim().min(3, "标题至少 3 个字").max(80, "标题过长"),
  summary: z.string().trim().max(160, "简介过长").optional().default(""),
  description: z.string().trim().min(10, "描述至少 10 个字").max(20000, "描述过长"),
  categoryId: z.string().min(1, "请选择分类"),
  tags: z.string().trim().max(400, "标签过长").optional().default(""),
  externalUrl: z
    .string()
    .trim()
    // 站内附件路径（/uploads/...）或 http(s) 外链
    .refine(
      (v) => !v || /^https?:\/\/.+/i.test(v) || /^\/[^/].*$/i.test(v),
      "外链需以 http(s):// 开头",
    )
    .optional()
    .default(""),
});

export async function createResourceAction(
  _prev: ResourceActionState,
  fd: FormData,
): Promise<ResourceActionState> {
  const user = await activeUser();
  if (!user) return { error: "账号不可用或已被封禁" };

  const common = commonFields.safeParse({
    type: fd.get("type") ?? "",
    title: fd.get("title") ?? "",
    summary: fd.get("summary") ?? "",
    description: fd.get("description") ?? "",
    categoryId: fd.get("categoryId") ?? "",
    tags: fd.get("tags") ?? "",
    externalUrl: fd.get("externalUrl") ?? "",
  });
  if (!common.success) return { fieldErrors: common.error.flatten().fieldErrors };
  const { type, title, summary, description, categoryId, externalUrl } = common.data;
  // 外链下载语义仅属于 GAME（版本表/externalUrl 驱动 DownloadButton）；IMAGE/ARTICLE 的下载走 meta，
  // 这里把 externalUrl 对二者钉死为空，防伪造表单触发版本创建或外链下载按钮。
  const effectiveUrl = type === "GAME" ? externalUrl : "";

  // —— 类型化 meta ——
  const license = String(fd.get("license") ?? "").trim();

  // IMAGE 整包下载（dlMode none/file/link）；非 none 时 url 必为 http(s) 或站内 /uploads 路径
  const dlModeRaw = fd.get("dlMode");
  const dlMode = dlModeRaw === "file" || dlModeRaw === "link" ? dlModeRaw : "none";
  let download: { mode: "file" | "link"; url: string; fileName?: string; size?: string } | undefined;
  if (dlMode !== "none") {
    const url = String(fd.get("dlUrl") ?? "").trim();
    if (!/^https?:\/\/.+/i.test(url) && !/^\/[^/].*$/i.test(url))
      return { fieldErrors: { downloadUrl: ["选择文件/外链后需填写 http(s):// 或站内附件路径"] } };
    download = {
      mode: dlMode,
      url,
      fileName: String(fd.get("dlName") ?? "").trim() || undefined,
      size: String(fd.get("dlSize") ?? "").trim() || undefined,
    };
  }

  // ARTICLE 附件清单：单个 downloads JSON（客户端受控序列化）
  let downloads: unknown = [];
  try {
    downloads = JSON.parse(String(fd.get("downloads") ?? "[]"));
  } catch {
    downloads = [];
  }
  if (!Array.isArray(downloads)) downloads = [];

  let metaStr: string;
  if (type === "IMAGE") {
    const im = imageMetaSchema.safeParse({
      isAiGenerated: fd.get("isAiGenerated") === "on",
      aiTool: String(fd.get("aiTool") ?? "").trim() || undefined,
      aiModel: String(fd.get("aiModel") ?? "").trim() || undefined,
      original: fd.get("original") === "on",
      license,
      sourceNote: String(fd.get("sourceNote") ?? "").trim() || undefined,
      download,
    });
    if (!im.success) return { fieldErrors: im.error.flatten().fieldErrors };
    metaStr = JSON.stringify(im.data);
  } else if (type === "ARTICLE") {
    const am = articleMetaSchema.safeParse({ license, downloads });
    if (!am.success) return { fieldErrors: am.error.flatten().fieldErrors };
    metaStr = JSON.stringify(am.data);
  } else {
    const gm = gameMetaSchema.safeParse({
      version: String(fd.get("version") ?? "").trim() || undefined,
      size: String(fd.get("size") ?? "").trim() || undefined,
      platforms:
        String(fd.get("platforms") ?? "")
          .split(/[,，、\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8) || undefined,
      lang: String(fd.get("lang") ?? "").trim() || undefined,
      license,
      note: String(fd.get("note") ?? "").trim() || undefined,
    });
    if (!gm.success) return { fieldErrors: gm.error.flatten().fieldErrors };
    metaStr = JSON.stringify(gm.data);
  }

  // GAME 必填外链；文章可以无图（正文即内容）
  if (type === "GAME" && !externalUrl)
    return { fieldErrors: { externalUrl: ["游戏资源需填写网盘/外链地址"] } };

  // —— 媒体认领 ——
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
  const coverId = coverRaw || mediaIds[0] || "";
  if (type !== "ARTICLE" && mediaIds.length === 0)
    return { fieldErrors: { mediaIds: ["请至少上传一张图片"] } };

  // D6：可信/管理员免审直发，否则进审核队列
  const directPublish = user.trusted || user.role === "ADMIN" || user.role === "MODERATOR";
  const status = directPublish ? "PUBLISHED" : "PENDING";

  // SEO slug：标题含中文时先经 Edge 微软翻译成英文再 slugify；接口失败回退原文（保留原行为）
  const slug = await uniqueSlug((await translateToEnglish(title)) ?? title);

  // —— 标签：去重 + 预翻译 slug ——
  // 放事务外先算好，避免把逐条翻译的网络请求（可能各等几秒超时）挂进 DB 事务。
  const names = [
    ...new Set(
      String(fd.get("tags") ?? "")
        .split(/[,，、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, 12);
  // 标签 slug：含中文的名称同样先经 Edge 微软翻译成英文再 slugify，利于 SEO 与稳定外链；
  // 纯符号名 slugify 为空时用随机串兜底（不走 uniqueSlug——它查的是 resource 表）
  const tagEntries = await Promise.all(
    names.map(async (name) => ({
      name,
      slugName: slugify((await translateToEnglish(name)) ?? name) || `tag-${randomTail()}`,
    })),
  );

  let resource;
  try {
    resource = await prisma.$transaction(async (tx) => {
      const r = await tx.resource.create({
        data: {
          slug,
          title,
          summary: summary || null,
          description,
          type,
          categoryId,
          authorId: user.id,
          status,
          meta: metaStr,
          externalUrl: effectiveUrl || null,
          loginRequired: fd.get("loginRequired") === "on",
          allowComments: fd.get("allowComments") !== "off",
          publishedAt: status === "PUBLISHED" ? new Date() : null,
        },
      });

      // 标签（建/取 Tag 关联，唯一计数；slug 已在事务外翻译好，见上 tagEntries）
      for (const { name, slugName } of tagEntries) {
        // 命中顺序：新译英文 slug → 既存同名标签（改译前遗留的中文 slug 老标签，避免撞 name 唯一键建同名词条）→ 新建
        const tag =
          (await tx.tag.findUnique({ where: { slug: slugName } })) ??
          (await tx.tag.findUnique({ where: { name } })) ??
          (await tx.tag.create({ data: { slug: slugName, name } }).catch(async () => {
            // 并发下 create 撞唯一键：抓回先建好的同 slug/同名标签
            return (
              (await tx.tag.findUnique({ where: { slug: slugName } })) ??
              (await tx.tag.findUnique({ where: { name } }))
            );
          }));
        if (!tag) continue; // 兜底失败才走到（理论上不可达），放弃本条关联不阻塞发布
        const link = await tx.tagOnResource
          .create({ data: { resourceId: r.id, tagId: tag.id } })
          .catch(() => null); // 并发去重
        // 只有真正建立了关联才计数，重复关联不重复加
        if (link) await tx.tag.update({ where: { id: tag.id }, data: { count: { increment: 1 } } });
      }

      // 认领已上传的媒体并排序（只认领本人上传、未被占用的孤儿媒体；防把他人素材挂进自己资源）
      const claimedIds: string[] = [];
      for (let i = 0; i < mediaIds.length; i++) {
        const res = await tx.media.updateMany({
          where: { id: mediaIds[i], uploaderId: user.id, resourceId: null, commentId: null },
          data: { resourceId: r.id, sort: i },
        });
        if (res.count > 0) claimedIds.push(mediaIds[i]);
      }
      if (mediaIds.length > 0 && claimedIds.length === 0)
        throw new Error("媒体不可用或已归属其他内容");
      const finalCover = claimedIds.includes(coverId) ? coverId : (claimedIds[0] ?? null);
      if (finalCover)
        await tx.resource.update({ where: { id: r.id }, data: { coverMediaId: finalCover } });

      // 有下载地址的资源落首个版本记录（仅 GAME，版本号取 meta.version，缺省 1.0）
      if (effectiveUrl) {
        const ver =
          type === "GAME"
            ? (() => {
                try {
                  return JSON.parse(metaStr).version ?? "1.0";
                } catch {
                  return "1.0";
                }
              })()
            : "1.0";
        await tx.resourceVersion.create({
          data: {
            resourceId: r.id,
            version: ver,
            changelog: String(fd.get("changelog") ?? "").trim() || null,
            url: effectiveUrl,
          },
        });
      }
      return r;
    });
  } catch (e) {
    console.error("[createResource]", e);
    return { error: "发布失败，请稍后重试" };
  }

  if (status === "PUBLISHED") {
    revalidatePath("/", "layout");
    redirect(`/resources/${slug}`);
  }
  return { ok: true, pending: true, resourceId: resource.id };
}

// ---------- 版本管理：作者追加新版本 ----------

const versionSchema = z.object({
  resourceId: z.string().min(1),
  version: z.string().trim().min(1, "请填写版本号").max(40, "版本号过长"),
  changelog: z.string().trim().max(2000, "更新日志过长").optional().default(""),
  url: z
    .string()
    .trim()
    .refine(
      (v) => !v || /^https?:\/\/.+/i.test(v) || /^\/[^/].*$/i.test(v),
      "下载地址需以 http(s):// 开头",
    )
    .optional()
    .default(""),
});

export async function addVersionAction(
  _prev: ResourceActionState,
  fd: FormData,
): Promise<ResourceActionState> {
  const user = await activeUser();
  if (!user) return { error: "账号不可用或已被封禁" };

  const parsed = versionSchema.safeParse({
    resourceId: fd.get("resourceId") ?? "",
    version: fd.get("version") ?? "",
    changelog: fd.get("changelog") ?? "",
    url: fd.get("url") ?? "",
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  const { resourceId, version, changelog, url } = parsed.data;

  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, slug: true, authorId: true, type: true, meta: true, externalUrl: true },
  });
  if (!resource) return { error: "资源不存在" };
  if (resource.authorId !== user.id && user.role !== "ADMIN")
    return { error: "只有作者可发布新版本" };

  const finalUrl = url || resource.externalUrl;
  if (!finalUrl) return { fieldErrors: { url: ["请填写该版本的下载地址"] } };

  // GAME：同步 meta.version 供信息卡展示
  let metaStr = resource.meta;
  if (resource.type === "GAME" && metaStr) {
    try {
      metaStr = JSON.stringify({ ...JSON.parse(metaStr), version });
    } catch {
      // 原数据异常时不动 meta
    }
  }

  await prisma.$transaction([
    prisma.resourceVersion.create({
      data: { resourceId: resource.id, version, changelog: changelog || null, url: finalUrl },
    }),
    prisma.resource.update({
      where: { id: resource.id },
      data: { meta: metaStr, externalUrl: finalUrl },
    }),
  ]);
  revalidatePath(`/resources/${resource.slug}`);
  return { ok: true };
}

/** 版本下载计数（会话内不重复计） */
export async function bumpVersionDownloadAction(versionId: string): Promise<{ ok: boolean }> {
  const v = await prisma.resourceVersion.findUnique({
    where: { id: versionId },
    select: { id: true, url: true, resourceId: true, resource: { select: { externalUrl: true } } },
  });
  if (!v) return { ok: false };
  const ck = await cookies();
  const marker = ck.get("dl_done")?.value ?? "";
  if (!marker.includes(versionId)) {
    await prisma.resourceVersion.update({
      where: { id: versionId },
      data: { downloadCount: { increment: 1 } },
    });
    ck.set("dl_done", `${marker},${versionId}`.slice(0, 1024), { path: "/", maxAge: 60 * 60 * 24 });
  }
  return { ok: true };
}
