"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { imageMetaSchema, gameMetaSchema, articleMetaSchema } from "@/lib/meta";
import { uniqueSlug, slugify } from "@/lib/slug";
import { revalidatePath } from "next/cache";

export type ResourceActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  ok?: boolean;
  pending?: boolean; // 已进入审核队列
  resourceId?: string;
};

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
    .refine((v) => !v || /^https?:\/\/.+/i.test(v), "外链需以 http(s):// 开头")
    .optional()
    .default(""),
});

export async function createResourceAction(
  _prev: ResourceActionState,
  fd: FormData
): Promise<ResourceActionState> {
  const session = await auth();
  const user = session?.user;
  if (!user) return { error: "请先登录" };

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
  const { type, title, summary, description, categoryId, tags, externalUrl } = common.data;

  // —— 类型化 meta ——
  const license = String(fd.get("license") ?? "").trim();
  let metaStr: string;
  if (type === "IMAGE") {
    const im = imageMetaSchema.safeParse({
      isAiGenerated: fd.get("isAiGenerated") === "on",
      aiTool: String(fd.get("aiTool") ?? "").trim() || undefined,
      aiModel: String(fd.get("aiModel") ?? "").trim() || undefined,
      original: fd.get("original") === "on",
      license,
      sourceNote: String(fd.get("sourceNote") ?? "").trim() || undefined,
    });
    if (!im.success) return { fieldErrors: im.error.flatten().fieldErrors };
    metaStr = JSON.stringify(im.data);
  } else if (type === "ARTICLE") {
    const am = articleMetaSchema.safeParse({ license });
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
  if (type === "GAME" && !externalUrl) return { fieldErrors: { externalUrl: ["游戏资源需填写网盘/外链地址"] } };

  // —— 媒体认领 ——
  let mediaIds: string[] = [];
  try {
    const parsed = JSON.parse(String(fd.get("mediaIds") ?? "[]"));
    mediaIds = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    mediaIds = [];
  }
  const coverRaw = String(fd.get("coverId") ?? "").trim();
  const coverId = coverRaw || mediaIds[0] || "";
  if (type !== "ARTICLE" && mediaIds.length === 0) return { fieldErrors: { mediaIds: ["请至少上传一张图片"] } };

  // D6：可信/管理员免审直发，否则进审核队列
  const directPublish =
    user.trusted || user.role === "ADMIN" || user.role === "MODERATOR";
  const status = directPublish ? "PUBLISHED" : "PENDING";

  const slug = await uniqueSlug(title);

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
          externalUrl: externalUrl || null,
          loginRequired: fd.get("loginRequired") === "on",
          allowComments: fd.get("allowComments") !== "off",
          publishedAt: status === "PUBLISHED" ? new Date() : null,
        },
      });

      // 标签（去重 + 计数）
      const names = [
        ...new Set(
          String(fd.get("tags") ?? "")
            .split(/[,，、\s]+/)
            .map((t) => t.trim())
            .filter(Boolean)
        ),
      ].slice(0, 12);
      for (const name of names) {
        const slugName = slugify(name) || (await uniqueSlug(`tag-${name}`));
        const tag = await tx.tag.upsert({ where: { slug: slugName }, update: {}, create: { slug: slugName, name } });
        await tx.tagOnResource
          .create({ data: { resourceId: r.id, tagId: tag.id } })
          .catch(() => undefined); // 并发去重
        await tx.tag.update({ where: { id: tag.id }, data: { count: { increment: 1 } } });
      }

      // 认领已上传的媒体并排序
      for (let i = 0; i < mediaIds.length; i++) {
        await tx.media.updateMany({ where: { id: mediaIds[i] }, data: { resourceId: r.id, sort: i } });
      }
      if (coverId) await tx.resource.update({ where: { id: r.id }, data: { coverMediaId: coverId } });
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
