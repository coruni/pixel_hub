"use server";

// SEO 后台配置保存：仅管理员；SiteSetting(key="seo") 乐观锁写回，防后台并发互相覆盖。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { adminOnly, audit } from "@/lib/actions/_guards";
import { submitIndexNow } from "@/lib/indexnow";
import {
  SEO_KEY,
  seoConfigSchema,
  serializeSeoConfig,
  type SeoConfig,
} from "@/lib/seo-config";

export type SeoUpdateResult = { ok: boolean; error?: string };

const CONFLICT: SeoUpdateResult = { ok: false, error: "配置已被其他人修改，请刷新页面后重试" };

/** 全量保存 SEO 配置（表单整体提交；version 为读取时的乐观锁版本） */
export async function updateSeoConfigAction(
  raw: unknown,
  version: number,
): Promise<SeoUpdateResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const parsed = seoConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: "配置项格式不正确，请检查后重试" };
  const value = serializeSeoConfig(parsed.data as SeoConfig);

  const updated = await prisma.siteSetting.updateMany({
    where: { key: SEO_KEY, version },
    data: { value, version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    // 行不存在（首次保存）：首建；并发撞唯一键视为冲突
    const created = await prisma.siteSetting
      .createMany({ data: { key: SEO_KEY, value, version: 1 } })
      .catch(() => null);
    if (!created || created.count !== 1) return CONFLICT;
  }
  await audit(admin.id, "EDIT_SEO", "SITE_SETTING", SEO_KEY);
  // metadata 全站动态读取；刷新首页路由缓存与后台自身（SEO 配置已并入 /admin/runtime）
  revalidatePath("/admin/runtime");
  revalidatePath("/");
  return { ok: true };
}

// ---------- IndexNow 手动推送 ----------

/** 单次手动推送的资源条数上限：首页/浏览页 + 最近发布，用于首次验证密钥与补推存量 */
const PUSH_LIMIT = 200;

export type IndexNowPushResult = { ok: boolean; message: string };

/**
 * 后台「立即推送」：把首页、浏览页与最近发布的资源提交给 IndexNow。
 * 日常发布/审核通过已由 queueIndexNowForResource 自动推送，这里用于首次配置后验证密钥是否生效、以及补推存量内容。
 */
export async function pushIndexNowAction(): Promise<IndexNowPushResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, message: "仅管理员可操作" };

  const resources = await prisma.resource.findMany({
    // 与 sitemap 同一收录口径：仅已发布、非 NSFW
    where: { status: "PUBLISHED", nsfw: false },
    orderBy: { publishedAt: "desc" },
    take: PUSH_LIMIT,
    select: { slug: true },
  });
  const urls = ["/", "/browse", ...resources.map((r) => `/resources/${r.slug}`)];
  const result = await submitIndexNow(urls);
  await audit(
    admin.id,
    "PUSH_INDEXNOW",
    "SITE_SETTING",
    SEO_KEY,
    `${result.submitted} 个 URL${result.ok ? "" : `｜${result.error ?? result.status}`}`,
  );

  if (!result.ok) return { ok: false, message: result.error ?? "推送失败，请稍后重试" };
  return {
    ok: true,
    message: `已提交 ${result.submitted} 个 URL${result.error ? `（${result.error}）` : ""}`,
  };
}
