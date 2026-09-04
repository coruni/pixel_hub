// 站点外观 —— 服务端读取层（渲染 / 后台初始化共用）。配置结构校验见 site-config.ts。
import { cache } from "react";
import { prisma } from "@/lib/db/prisma";
import {
  DEFAULT_THEME,
  THEME_KEY,
  parseTheme,
  serializeTheme,
  type Theme,
} from "@/lib/site-config";

/** 读取主题设置；未落库时返回代码内默认（不写库，绝不空白）。请求内去重（page 与 sidebar 共用） */
export const getTheme = cache(async (): Promise<Theme> => {
  const row = await prisma.siteSetting.findUnique({ where: { key: THEME_KEY } });
  if (!row) return parseTheme(null);
  let value: unknown = null;
  try {
    value = JSON.parse(row.value);
  } catch {
    value = null;
  }
  return parseTheme(value);
});

/** 读取原始值是否存在（后台判空用） */
export async function siteSettingExists(key: string): Promise<boolean> {
  return !!(await prisma.siteSetting.findUnique({ where: { key }, select: { key: true } }));
}

/** 空表落库默认主题（后台站点布局页打开前调用），幂等 */
export async function ensureSiteTheme(): Promise<void> {
  const row = await prisma.siteSetting.findUnique({
    where: { key: THEME_KEY },
    select: { key: true },
  });
  if (row) return;
  await prisma.siteSetting.create({
    data: { key: THEME_KEY, value: serializeTheme(DEFAULT_THEME) },
  });
}

export type ThemeView = Theme;

/** 详情页当前生效模板：type 覆盖 > 全站默认 */
export function detailTemplateFor(theme: Theme, type: string): string {
  const byType = theme.detailTemplate.byType as Record<string, string | undefined> | undefined;
  const ov = byType?.[type];
  return ov ?? theme.detailTemplate.default;
}
