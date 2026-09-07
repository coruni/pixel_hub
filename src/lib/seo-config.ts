// SEO 后台配置 —— 结构校验 + 服务端读取层（layout/robots/详情页 JSON-LD 共用）。
// 存储沿用 SiteSetting（key="seo"，JSON + 乐观锁 version）；解析非法一律回退默认，绝不让前台空白。
// 注意：schema 只做形状与默认值（zod v4 的 transform 管道不继承 default），输出规范化统一走 sanitizeSeo。
import { cache } from "react";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { siteName as fallbackSiteName } from "@/lib/site-url";

export const SEO_KEY = "seo";

export const seoConfigSchema = z.object({
  // 站点名称（<title> / OG siteName / JSON-LD / 导航徽标）；空 = 回退 env NEXT_PUBLIC_SITE_NAME
  siteName: z.string().default(""),
  // meta keywords（Google 忽略，百度/Yandex 仍参考）；逗号分隔；空 = 不输出
  keywords: z.string().default(""),
  // 各搜索引擎站长平台验证码；空 = 不输出对应 meta
  verifications: z
    .object({
      google: z.string().default(""), // google-site-verification
      bing: z.string().default(""), // msvalidate.01（Bing，同时覆盖 Yahoo 网页搜索）
      yandex: z.string().default(""), // yandex-verification
      baidu: z.string().default(""), // baidu-site-verification
    })
    .default({ google: "", bing: "", yandex: "", baidu: "" }),
  // OG 语言区域（zh_CN / en_US 等）；非法值回退默认
  ogLocale: z.string().default(""),
  // 默认 meta description；空 = 回退代码内文案（含站点名）
  defaultDescription: z.string().default(""),
  // 结构化数据（WebSite / Article / BreadcrumbList）总开关
  structuredData: z.boolean().default(true),
});

export type SeoConfig = z.infer<typeof seoConfigSchema>;

export const DEFAULT_SEO: SeoConfig = seoConfigSchema.parse({});

const LOCALE_RE = /^[a-z]{2}(_[A-Za-z]{2,4})?$/;

/** 规范化输出：trim、locale 归一（非法/空回退 zh_CN）、描述截断 300 */
export function sanitizeSeo(config: SeoConfig): SeoConfig {
  const locale = config.ogLocale.trim().slice(0, 12).replace("-", "_");
  return {
    siteName: config.siteName.trim().slice(0, 40),
    keywords: config.keywords.trim().slice(0, 200),
    verifications: {
      google: config.verifications.google.trim().slice(0, 200),
      bing: config.verifications.bing.trim().slice(0, 200),
      yandex: config.verifications.yandex.trim().slice(0, 200),
      baidu: config.verifications.baidu.trim().slice(0, 200),
    },
    ogLocale: locale && LOCALE_RE.test(locale) ? locale : "zh_CN",
    defaultDescription: config.defaultDescription.trim().slice(0, 300),
    structuredData: config.structuredData === true,
  };
}

/** 解析落库 JSON：非法/缺失字段一律回退默认，不抛错 */
export function parseSeoConfig(value: unknown): SeoConfig {
  const result = seoConfigSchema.safeParse(value ?? {});
  if (!result.success) return DEFAULT_SEO;
  return sanitizeSeo(result.data);
}

export function serializeSeoConfig(config: SeoConfig): string {
  return JSON.stringify(sanitizeSeo(seoConfigSchema.parse(config)));
}

/** 请求级去重读取（layout 与页面同请求共用一次查询） */
export const getSeoConfig = cache(async (): Promise<SeoConfig> => {
  const row = await prisma.siteSetting.findUnique({ where: { key: SEO_KEY } });
  if (!row) return DEFAULT_SEO;
  let value: unknown = null;
  try {
    value = JSON.parse(row.value);
  } catch {
    value = null;
  }
  return parseSeoConfig(value);
});

/** 后台编辑用：配置 + 乐观锁版本（行不存在时 version=0，首建后自增） */
export async function getSeoWithVersion(): Promise<{ config: SeoConfig; version: number }> {
  const row = await prisma.siteSetting.findUnique({ where: { key: SEO_KEY } });
  if (!row) return { config: DEFAULT_SEO, version: 0 };
  let value: unknown = null;
  try {
    value = JSON.parse(row.value);
  } catch {
    value = null;
  }
  return { config: parseSeoConfig(value), version: row.version };
}

/** JSON-LD 序列化：转义 < 防 </script> 提前闭合（XSS 兜底） */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** 站点名解析：后台配置优先，未配置回退 env NEXT_PUBLIC_SITE_NAME（站点展示统一入口） */
export function resolveSiteName(seo: SeoConfig): string {
  return seo.siteName || fallbackSiteName();
}
