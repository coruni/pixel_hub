import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db/prisma";
import { siteUrl } from "@/lib/site-url";

export const revalidate = 3600; // 每小时重新生成

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/browse`, changeFrequency: "hourly", priority: 0.8 },
    // 注意：/search 已并入 /browse 并由 next.config redirects 301 跳转，
    // sitemap 不得收录会跳转的 URL（Bing 会报 "URL redirects" 并浪费抓取配额）
    { url: `${base}/rules`, changeFrequency: "yearly", priority: 0.2 },
  ];

  // 已发布资源详情；未发布/下架的详情页不可收录
  const [resources, categories, tags] = await Promise.all([
    prisma.resource.findMany({
      // D9：sitemap 只列 SFW；NSFW 详情另有 noindex + 未登录 404，不进入收录面
      where: { status: "PUBLISHED", nsfw: false },
      select: { slug: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
      take: 2000,
    }),
    prisma.category.findMany({ select: { slug: true } }),
    prisma.tag.findMany({ where: { count: { gt: 0 } }, select: { slug: true }, take: 500 }),
  ]);

  return [
    ...staticEntries,
    ...resources.map((r) => ({
      url: `${base}/resources/${r.slug}`,
      lastModified: r.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...categories.map((c) => ({
      url: `${base}/browse?cat=${c.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
    ...tags.map((t) => ({
      url: `${base}/tags/${t.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.4,
    })),
  ];
}
