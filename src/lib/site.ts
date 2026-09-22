// 站点外观 —— 服务端读取层（渲染 / 后台初始化共用）。配置结构校验见 site-config.ts。
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { CACHE_TAGS, CONFIG_CACHE_REVALIDATE_SECONDS } from "@/lib/cache-tags";
import {
  DEFAULT_THEME,
  THEME_KEY,
  parseTheme,
  serializeTheme,
  type Theme,
} from "@/lib/site-config";

/**
 * 读取主题设置；未落库时返回代码内默认（不写库，绝不空白）—— 跨请求缓存。
 *
 * 改前是 React `cache()`：只在单次请求内去重（page 与 sidebar 共用），跨请求每次重查。
 * 主题决定了导航、侧栏、布局骨架，几乎每个页面都要读，所以它值得跨请求缓存。
 *
 * 失效：写入方（src/lib/actions/site.ts 与下方 ensureDefaultTheme）调用
 * revalidateTag(CACHE_TAGS.siteSetting, "max")；另加兜底 TTL。
 */
export const getTheme = unstable_cache(
  async (): Promise<Theme> => {
    const row = await prisma.siteSetting.findUnique({ where: { key: THEME_KEY } });
    if (!row) return parseTheme(null);
    let value: unknown = null;
    try {
      value = JSON.parse(row.value);
    } catch {
      value = null;
    }
    return parseTheme(value);
  },
  ["site-theme"],
  { tags: [CACHE_TAGS.siteSetting], revalidate: CONFIG_CACHE_REVALIDATE_SECONDS },
);

/** 读取原始值是否存在（后台判空用） */
export async function siteSettingExists(key: string): Promise<boolean> {
  return !!(await prisma.siteSetting.findUnique({ where: { key }, select: { key: true } }));
}

/**
 * 空表落库默认主题（后台站点布局页打开前调用），幂等。
 *
 * 这里**刻意不调用 revalidateTag**，两个原因：
 *   1. 本函数是在**页面渲染**期间调用的（src/app/admin/site/page.tsx），
 *      而 revalidateTag 只能在 Server Action / Route Handler 里调用，渲染期调用会报错；
 *   2. 也不必要 —— 它落库的值就是 `serializeTheme(DEFAULT_THEME)`，与 getTheme 在
 *      「行不存在」时返回的默认值完全等价，所以缓存里那份旧结果依然是正确的。
 * 真正会改变主题内容的是后台保存动作，失效已挂在 src/lib/actions/site.ts 的 themeRevalidate()。
 */
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
