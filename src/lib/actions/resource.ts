"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { imageMetaSchema, gameMetaSchema, articleMetaSchema, avMetaSchema } from "@/lib/meta";
import { autoSlugBase, randomTail, uniqueSlug } from "@/lib/slug";
import { revalidatePath } from "next/cache";
import { resourceTextFields, urlLike } from "@/lib/resource-fields";
import { applyResourceEdit, type ResourceEditState } from "@/lib/actions/_resource-edit";
import { getUploadLimits } from "@/lib/upload-limits";
import { ARTICLE_MEDIA_MAX, isSingleCoverType } from "@/lib/upload-config";
import { TYPE_LABEL } from "@/lib/display";
import { syncResourceSearch } from "@/lib/search";
import { queueIndexNowForResource } from "@/lib/indexnow";
import { discardDraft } from "@/lib/draft-store";
import { createNotification, notifyStaff } from "@/lib/notify";
import { awardPoints } from "@/lib/points";

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

const commonFields = resourceTextFields.extend({
  type: z.enum(["GAME", "IMAGE", "ARTICLE", "MUSIC", "VIDEO"]),
});

/** 从下载源清单里解析出 GAME 的主下载地址（取首条有效 url）。
 *  发布页已移除独立的「下载外链」输入，resource.externalUrl 改为由清单推导，
 *  这样详情页主下载、版本记录首条、下载计数守卫、/api/dl 代理都不必改。 */
function externalUrlFromDownloads(fd: FormData): string {
  let list: unknown[] = [];
  try {
    const parsed = JSON.parse(String(fd.get("downloads") ?? "[]"));
    list = Array.isArray(parsed) ? parsed : [];
  } catch {
    return "";
  }
  for (const d of list) {
    if (!d || typeof d !== "object") continue;
    const url = String((d as { url?: unknown }).url ?? "").trim();
    if (url && urlLike(url)) return url;
  }
  // 兜底：老表单/外部 API 仍可只传 externalUrl
  const legacy = String(fd.get("externalUrl") ?? "").trim();
  return urlLike(legacy) ? legacy : "";
}

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
  const { type, title, summary, description, categoryId } = common.data;
  // 外链下载语义仅属于 GAME（externalUrl 驱动详情页主下载入口与版本表）；IMAGE/ARTICLE 的下载走 meta。
  // 发布页已移除「下载外链」输入，GAME 的外链改由下面的下载源清单首条推导（见 gameSources）。
  const effectiveUrl = type === "GAME" ? externalUrlFromDownloads(fd) : "";

  // —— 类型化 meta ——
  const license = String(fd.get("license") ?? "").trim();

  // 附件清单：IMAGE 多附件图包 / ARTICLE 文末清单 / GAME 下载源，同源 downloads JSON（各分节受控序列化）
  let downloads: unknown[] = [];
  try {
    const parsed = JSON.parse(String(fd.get("downloads") ?? "[]"));
    downloads = Array.isArray(parsed) ? parsed : [];
  } catch {
    downloads = [];
  }

  let metaStr: string;
  if (type === "IMAGE") {
    const im = imageMetaSchema.safeParse({
      isAiGenerated: fd.get("isAiGenerated") === "on",
      aiTool: String(fd.get("aiTool") ?? "").trim() || undefined,
      aiModel: String(fd.get("aiModel") ?? "").trim() || undefined,
      original: fd.get("original") === "on",
      license,
      sourceNote: String(fd.get("sourceNote") ?? "").trim() || undefined,
      downloads,
    });
    if (!im.success) return { fieldErrors: im.error.flatten().fieldErrors };
    metaStr = JSON.stringify(im.data);
  } else if (type === "ARTICLE") {
    const am = articleMetaSchema.safeParse({ license, downloads });
    if (!am.success) return { fieldErrors: am.error.flatten().fieldErrors };
    metaStr = JSON.stringify(am.data);
  } else if (type === "MUSIC" || type === "VIDEO") {
    // 音视频：来源（在线挂载 / 上传文件）+ 播放形态（直链 / 嵌入页），URL 与字段由 avMetaSchema 统一校验
    const am = avMetaSchema.safeParse({
      source: String(fd.get("avSource") ?? "mount") === "file" ? "file" : "mount",
      mode: String(fd.get("avMode") ?? "direct") === "embed" ? "embed" : "direct",
      url: String(fd.get("avUrl") ?? "").trim(),
      artist: String(fd.get("artist") ?? "").trim() || undefined,
      duration: String(fd.get("duration") ?? "").trim() || undefined,
      resolution: String(fd.get("resolution") ?? "").trim() || undefined,
      downloads,
    });
    if (!am.success) return { fieldErrors: am.error.flatten().fieldErrors };
    metaStr = JSON.stringify(am.data);
  } else {
    const gm = gameMetaSchema.safeParse({
      platforms:
        String(fd.get("platforms") ?? "")
          .split(/[,，、\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8) || undefined,
      lang: String(fd.get("lang") ?? "").trim() || undefined,
      downloads,
    });
    if (!gm.success) return { fieldErrors: gm.error.flatten().fieldErrors };
    metaStr = JSON.stringify(gm.data);
  }

  // GAME 必填下载源（清单里至少一条有效 url）；文章可以无图（正文即内容）
  const gameSources =
    type === "GAME"
      ? downloads
          .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
          .map((d) => String(d.url ?? "").trim())
          .filter((u) => !!u && urlLike(u))
      : [];
  if (type === "GAME" && gameSources.length === 0)
    return { fieldErrors: { downloads: ["请至少添加一条有效的下载地址（http(s):// 或站内附件路径）"] } };

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
  // 图集类（游戏 / 图片）必须有图；封面类（文章 / 音乐 / 视频）封面可选 —— 与向导「封面不标必填」一致
  if (!isSingleCoverType(type) && mediaIds.length === 0)
    return { fieldErrors: { mediaIds: ["请至少上传一张图片"] } };

  // 图片数量上限：以 /admin/uploads 配置为准，发布入口（向导/API）与这里双重强制。
  const L = await getUploadLimits();
  if (type === "IMAGE" && mediaIds.length > L.galleryImageMaxCount)
    return { fieldErrors: { mediaIds: [`图片不能超过 ${L.galleryImageMaxCount} 张`] } };
  if (isSingleCoverType(type) && mediaIds.length > ARTICLE_MEDIA_MAX)
    return {
      fieldErrors: {
        mediaIds: [
          `${TYPE_LABEL[type] ?? "该类型"}只需 ${ARTICLE_MEDIA_MAX} 张封面图，其余插图放正文里`,
        ],
      },
    };

  // D6：可信/管理员免审直发，否则进审核队列
  const directPublish = user.trusted || user.role === "ADMIN" || user.role === "MODERATOR";
  const status = directPublish ? "PUBLISHED" : "PENDING";

  // SEO slug：中文标题先经 Edge 翻译成英文，接口不可用则退回拼音（见 autoSlugBase）——
  // 落库 slug 恒为纯 ASCII，中文 slug 会让 redirect() 写响应头时抛 ERR_INVALID_CHAR
  const slug = await uniqueSlug(await autoSlugBase(title));

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
  // 标签 slug：含中文的名称同样「翻译 → 拼音」，落库恒为纯 ASCII；
  // 纯符号名（转不出字母/数字）用随机串兜底（不走 uniqueSlug——它查的是 resource 表）
  const tagEntries = await Promise.all(
    names.map(async (name) => ({
      name,
      slugName: (await autoSlugBase(name)) || `tag-${randomTail()}`,
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
          nsfw: fd.get("nsfw") === "on",
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

      // 版本记录只在「发布新版本」时由 addVersionAction 创建。
      // 发布/改稿都不再往 ResourceVersion 写——GAME 的下载源清单存 meta.downloads，
      // 其余类型的下载源也各有自己的 meta.downloads，版本历史是作者主动声明的东西。
      return r;
    });
  } catch (e) {
    console.error("[createResource]", e);
    return { error: "发布失败，请稍后重试" };
  }

  // 全文索引同步（事务已提交后执行；内部已容错，失败不影响发布结果）
  await syncResourceSearch(resource.id);

  // 草稿使命结束：发布已落库，立刻清掉对应草稿，免得草稿箱里留一份已发布内容的副本。
  // 放在 redirect 之前，两条分支（免审直发 / 进审核队列）都会走到。
  const draftId = String(fd.get("draftId") ?? "").trim();
  if (draftId) await discardDraft(user.id, draftId.slice(0, 64));

  if (status === "PUBLISHED") {
    // 投稿奖励（贡献分）：免审直发绕过了审核队列，不能只让 approveResourceAction 发分，
    // 否则 trusted / ADMIN / MODERATOR 直发的内容一分不得。refId=资源 id，与审核通过那条路径
    // 共用同一个幂等键，回填过的存量资源也不会重复计分。
    // actorId 记本人：PUBLISH 不在 NO_SELF_BENEFIT 内（见 points.ts 的说明），不会被自产自销拦截。
    after(() =>
      awardPoints({ userId: user.id, actorId: user.id, reason: "PUBLISH", refId: resource.id }),
    );
    // 免审直发的内容立即告知搜索引擎（after 在响应后执行，不拖慢跳转；未启用时内部跳过）
    queueIndexNowForResource(resource.id);
    revalidatePath("/", "layout");
    // slug 可能含中文（标题含中文且翻译接口不可用时 slugify 会保留汉字），这里必须转义：
    // Next 把 redirect() 目标**原样**写进 x-action-redirect 响应头（action-handler.js：
    // res.setHeader('x-action-redirect', `${url};${type}`)），而 Node 的头值只接受 Latin-1，
    // 汉字会让 setHeader 抛 ERR_INVALID_CHAR —— 资源已落库却整个 action 响应失败。
    // 路由侧会解码 %XX，所以转义后的路径照样命中同一资源。
    redirect(`/resources/${encodeURIComponent(slug)}`);
  }
  // 进入审核队列：作者收「已提交待审」回执，值班 staff 收「有待审投稿」提醒
  // （两者都靠推送，否则作者只能干等、管理员只能靠手动刷队列页）
  await createNotification({
    userId: user.id,
    type: "MODERATION",
    resourceId: resource.id,
    message: `《${title}》已提交成功，正在等待审核，结果出来后我们会通知你`,
  });
  await notifyStaff({
    actorId: user.id,
    type: "SYSTEM",
    resourceId: resource.id,
    message: `有新的投稿待审核：《${title}》`,
  });
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
    select: { id: true, slug: true, authorId: true, type: true, externalUrl: true },
  });
  if (!resource) return { error: "资源不存在" };
  if (resource.authorId !== user.id && user.role !== "ADMIN")
    return { error: "只有作者可发布新版本" };
  // GAME 没有版本概念：下载源清单在编辑页维护，不接受「发布新版本」
  if (resource.type === "GAME") return { error: "游戏下载源请在编辑页维护，无需发布版本" };

  const finalUrl = url || resource.externalUrl;
  if (!finalUrl) return { fieldErrors: { url: ["请填写该版本的下载地址"] } };

  await prisma.$transaction([
    prisma.resourceVersion.create({
      data: { resourceId: resource.id, version, changelog: changelog || null, url: finalUrl },
    }),
    prisma.resource.update({
      where: { id: resource.id },
      data: { externalUrl: finalUrl },
    }),
  ]);
  revalidatePath(`/resources/${resource.slug}`);
  return { ok: true };
}

// ---------- 作者改稿：仅允许编辑自己发布的资源 ----------

export async function updateResourceOwnerAction(
  _prev: ResourceEditState,
  fd: FormData,
): Promise<ResourceEditState> {
  const user = await activeUser();
  if (!user) return { error: "账号不可用或已被封禁" };

  const id = String(fd.get("id") ?? "");
  if (!id) return { error: "缺少资源" };

  const resource = await prisma.resource.findUnique({
    where: { id },
    select: { id: true, type: true, slug: true, authorId: true },
  });
  if (!resource) return { error: "资源不存在" };
  if (resource.authorId !== user.id) return { error: "只能编辑自己发布的资源" };

  try {
    const res = await prisma.$transaction(async (tx) =>
      applyResourceEdit(tx, id, resource.type, fd, user.id),
    );
    if (res.fieldErrors) return { fieldErrors: res.fieldErrors };
  } catch (e) {
    console.error("[updateResourceOwner]", e);
    return { error: "保存失败，请稍后重试" };
  }

  // 全文索引同步（正文已变更；失败仅告警）
  await syncResourceSearch(resource.id);

  revalidatePath(`/resources/${resource.slug}`);
  revalidatePath("/", "layout");
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
