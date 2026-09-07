import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getCollections, getRelated, getResourceDetail, type ResourceDetail } from "@/lib/queries";
import { parseMeta } from "@/lib/meta";
import { getTheme, detailTemplateFor } from "@/lib/site";
import { sidebarVisible } from "@/lib/site-config";
import SiteSidebar, { WidgetArea, type DetailWidgetCtx } from "@/components/sidebar/SiteSidebar";
import SidebarLayout from "@/components/layout/SidebarLayout";
import DetailPost from "@/components/resource/detail/DetailPost";
import DetailBanner from "@/components/resource/detail/DetailBanner";
import DetailTwocol from "@/components/resource/detail/DetailTwocol";
import DetailArticle from "@/components/resource/detail/DetailArticle";
import { PendingBanner, type DetailCtx } from "@/components/resource/detail/parts";
import { TYPE_LABEL } from "@/lib/display";
import { siteName, siteUrl } from "@/lib/site-url";
import { getSeoConfig, jsonLd } from "@/lib/seo-config";

type PageProps = { params: Promise<{ slug: string }> };

const SITE_ORIGIN = `${siteUrl()}/`;
const absUrl = (path: string) => new URL(path, SITE_ORIGIN).toString();

/** 详情页结构化数据：Article + BreadcrumbList（仅已发布 SFW 内容；图片/日期缺省时省略对应字段） */
function buildDetailLd(detail: NonNullable<ResourceDetail>): { article: object; breadcrumb: object } {
  const authorName = detail.author.name || detail.author.username;
  const itemListElement: object[] = [
    { "@type": "ListItem", position: 1, name: siteName(), item: siteUrl() },
  ];
  if (detail.category)
    itemListElement.push({
      "@type": "ListItem",
      position: 2,
      name: detail.category.name,
      item: absUrl(`/browse?cat=${encodeURIComponent(detail.category.slug)}`),
    });
  itemListElement.push({
    "@type": "ListItem",
    position: itemListElement.length + 1,
    name: detail.title,
    item: absUrl(`/resources/${detail.slug}`),
  });
  const cover = detail.gallery[0];
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: detail.title.slice(0, 110),
    ...(detail.summary ? { description: detail.summary } : {}),
    ...(cover ? { image: [absUrl(cover.bigUrl)] } : {}),
    ...(detail.publishedAt ? { datePublished: detail.publishedAt.toISOString() } : {}),
    dateModified: detail.updatedAt.toISOString(),
    author: { "@type": "Person", name: authorName, url: absUrl(`/u/${detail.author.username}`) },
    publisher: { "@type": "Organization", name: siteName() },
    mainEntityOfPage: absUrl(`/resources/${detail.slug}`),
    inLanguage: "zh-CN",
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  };
  return { article, breadcrumb };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  // 仅「slug 完全不存在」时 404：页面有 loading 流式壳，等 page 里再 notFound() 状态码已是 200。
  // 注意不能按 status 判断——草稿/待审的作者预览也走这里
  const exists = await prisma.resource.findUnique({ where: { slug }, select: { id: true } });
  if (!exists) notFound();
  // 与 page 同参（含 viewerId）：cache() 同请求去重，草稿预览也能拿到真实标题
  const session = await auth();
  const meId =
    typeof session?.user?.id === "string" && session.user.id ? session.user.id : undefined;
  const r = await getResourceDetail(slug, meId);
  if (!r || r.status !== "PUBLISHED")
    return { title: r?.title ?? "未发布内容", robots: { index: false } };

  // D9：NSFW 详情永不收录 —— 未登录访问在 page 层直接 404，登录后可见但同样拒绝索引
  if (r.nsfw) return { title: r.title, robots: { index: false, follow: false } };

  const description =
    r.summary ??
    `${r.author.name ?? "@" + r.author.username} 分享的${TYPE_LABEL[r.type] ?? "资源"}`;
  const ogImages = r.gallery[0] ? [r.gallery[0].bigUrl] : [];
  return {
    title: r.title,
    description,
    alternates: { canonical: `/resources/${r.slug}` },
    openGraph: {
      // 页级 openGraph 不与根布局合并，siteName 需自带
      siteName: siteName(),
      title: r.title,
      description,
      type: "article",
      images: ogImages as string[],
    },
  };
}

export default async function ResourcePage({ params }: PageProps) {
  const { slug } = await params;
  const session = await auth();
  const me = session?.user;
  const meId = typeof me?.id === "string" && me.id ? me.id : undefined;
  const [detail, theme, myCollections] = await Promise.all([
    getResourceDetail(slug, meId),
    getTheme(),
    meId ? getCollections(meId) : Promise.resolve([]),
  ]);

  if (!detail) notFound();
  // 未发布内容仅作者/管理可见
  if (detail.status !== "PUBLISHED") {
    const isOwner = meId === detail.authorId;
    const isStaff = me?.role === "ADMIN" || me?.role === "MODERATOR";
    if (!isOwner && !isStaff) notFound();
  }
  // D9：NSFW 详情登录门 —— 已发布成人内容仅登录后可见，未登录一律 404（不进索引/不泄露图）
  if (detail.status === "PUBLISHED" && detail.nsfw && !meId) notFound();

  // 相关推荐只对已发布内容计算（草稿/待审不需要）
  const related =
    detail.status === "PUBLISHED"
      ? await getRelated({
          id: detail.id,
          type: detail.type,
          category: detail.category,
          tags: detail.tags.map((t) => ({ slug: t.tag.slug })),
        })
      : [];

  const ctx: DetailCtx = {
    detail,
    meta: parseMeta(detail.type, detail.meta as string | null),
    meId,
    authed: !!meId,
    isAuthor: meId === detail.authorId,
    isStaff: me?.role === "ADMIN" || me?.role === "MODERATOR",
    myCollections,
    related,
  };

  const template = detailTemplateFor(theme, detail.type);
  const showSidebar = sidebarVisible(theme, "detail") && detail.status === "PUBLISHED";
  const isPreview = detail.status !== "PUBLISHED";

  // 结构化数据仅对可收录内容输出（预览/草稿与 NSFW 均已 noindex）
  const seo = await getSeoConfig();
  const detailLd = seo.structuredData && !isPreview && !detail.nsfw ? buildDetailLd(detail) : null;

  // 详情页正文槽位（上/中/下，仅已发布内容；中部节点传给模板插在描述与评论之间）
  const detailCtx: DetailWidgetCtx = {
    id: detail.id,
    type: detail.type,
    authorUsername: detail.author.username,
    categorySlug: detail.category?.slug ?? null,
  };
  const hasSlot = (area: "detailTop" | "detailMiddle" | "detailBottom") =>
    theme.slots[area].some((w) => w.enabled);
  const topSlot =
    !isPreview && hasSlot("detailTop") ? (
      <WidgetArea theme={theme} area="detailTop" detail={detailCtx} />
    ) : null;
  const bottomSlot =
    !isPreview && hasSlot("detailBottom") ? (
      <WidgetArea theme={theme} area="detailBottom" detail={detailCtx} />
    ) : null;
  const middleSlot =
    !isPreview && hasSlot("detailMiddle") ? (
      <WidgetArea theme={theme} area="detailMiddle" detail={detailCtx} />
    ) : null;

  const body =
    template === "banner" ? (
      <DetailBanner ctx={ctx} middleSlot={middleSlot} />
    ) : template === "twocol" ? (
      <DetailTwocol ctx={ctx} middleSlot={middleSlot} />
    ) : template === "article" ? (
      <DetailArticle ctx={ctx} middleSlot={middleSlot} />
    ) : (
      <DetailPost ctx={ctx} middleSlot={middleSlot} />
    );

  // 提醒条与各模板内容列同为 max-w-6xl 居中，宽度一致
  const previewCls = "mx-auto max-w-6xl px-4 pt-8 sm:px-6";

  return (
    <SidebarLayout
      railWidth={theme.sidebar.width}
      rail={
        showSidebar ? <SiteSidebar theme={theme} page="detail" detail={detailCtx} /> : undefined
      }
    >
      {detailLd && (
        <>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: jsonLd(detailLd.article) }}
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: jsonLd(detailLd.breadcrumb) }}
          />
        </>
      )}
      {topSlot && <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">{topSlot}</div>}
      {isPreview && (
        <div className={previewCls}>
          <PendingBanner ctx={ctx} />
        </div>
      )}
      {body}
      {bottomSlot && <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">{bottomSlot}</div>}
    </SidebarLayout>
  );
}
