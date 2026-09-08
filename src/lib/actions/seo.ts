"use server";

// SEO 后台配置保存：仅管理员；SiteSetting(key="seo") 乐观锁写回，防后台并发互相覆盖。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { adminOnly, audit } from "@/lib/actions/_guards";
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
