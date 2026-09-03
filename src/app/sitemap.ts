import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db/prisma";
import { siteUrl } from "@/lib/site-url";

// 内容随发布动态变化，按请求生成（否则只在构建时跑一次）
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  // 静态/列表页（/tags 只有标签详情页，无索引页）
  const entries: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/browse`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/search`, changeFrequency: "weekly", priority: 0.5 },
  ];

  // 已发布资源（近 5000 条）
  const resources = await prisma.resource.findMany({
    where: { status: "PUBLISHED" },
    select: { slug: true, updatedAt: true },
    orderBy: { publishedAt: "desc" },
    take: 5000,
  });
  for (const r of resources) {
    entries.push({
      url: `${base}/resources/${r.slug}`,
      lastModified: r.updatedAt,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  // 分类 / 标签
  const [categories, tags] = await Promise.all([
    prisma.category.findMany({ select: { slug: true } }),
    prisma.tag.findMany({ where: { count: { gt: 0 } }, select: { slug: true }, take: 500 }),
  ]);
  for (const c of categories) entries.push({ url: `${base}/browse?category=${c.slug}`, priority: 0.6 });
  for (const t of tags) entries.push({ url: `${base}/tags/${t.slug}`, priority: 0.4 });

  // 用户公开主页
  const users = await prisma.user.findMany({
    where: { bannedAt: null },
    select: { username: true },
    take: 2000,
  });
  for (const u of users) entries.push({ url: `${base}/u/${u.username}`, priority: 0.3 });

  return entries;
}
