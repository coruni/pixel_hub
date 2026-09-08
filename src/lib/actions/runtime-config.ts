"use server";

// 站点运行配置保存：仅管理员；SiteSetting(key="site-runtime") 乐观锁写回，防后台并发互相覆盖。
// 覆盖 GitHub OAuth / 存储驱动 / SMTP 邮件三类 .env 运营配置。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { adminOnly, audit } from "@/lib/actions/_guards";
import {
  RUNTIME_CONFIG_KEY,
  runtimeConfigSchema,
  runtimeConfigIssues,
  serializeRuntimeConfig,
  type RuntimeConfig,
} from "@/lib/runtime-config";

export type RuntimeConfigResult = { ok: boolean; error?: string };

const CONFLICT: RuntimeConfigResult = {
  ok: false,
  error: "配置已被其他人修改，请刷新页面后重试",
};

/** 全量保存运行配置（表单整体提交；version 为读取时的乐观锁版本） */
export async function updateRuntimeConfigAction(
  raw: unknown,
  version: number,
): Promise<RuntimeConfigResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const parsed = runtimeConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: "配置项格式不正确，请检查后重试" };
  const config = parsed.data as RuntimeConfig;
  const issues = runtimeConfigIssues(config);
  if (issues.length > 0) return { ok: false, error: issues[0] };
  const value = serializeRuntimeConfig(config);

  const updated = await prisma.siteSetting.updateMany({
    where: { key: RUNTIME_CONFIG_KEY, version },
    data: { value, version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    // 行不存在（首次保存）：首建；并发撞唯一键视为冲突
    const created = await prisma.siteSetting
      .createMany({ data: { key: RUNTIME_CONFIG_KEY, value, version: 1 } })
      .catch(() => null);
    if (!created || created.count !== 1) return CONFLICT;
  }
  await audit(admin.id, "EDIT_RUNTIME_CONFIG", "SITE_SETTING", RUNTIME_CONFIG_KEY);
  // 登录页（GitHub 按钮）、设置页（绑定入口）读此配置；刷新首页兜底
  revalidatePath("/admin/runtime");
  revalidatePath("/login");
  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true };
}
