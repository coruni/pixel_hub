import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getCollections, getRelated, getResourceDetail, type ResourceDetail } from "@/lib/queries";
import { parseMeta } from "@/lib/meta";
import { getTheme, detailTemplateFor } from "@/lib/site";
import { getIncentive } from "@/lib/incentive";
import { getPointBalance } from "@/lib/points";
import { levelOf } from "@/lib/points-config";
import { publicUrl } from "@/lib/storage/url";
import { profileBgUnlocked } from "@/lib/upload-config";
import { renderSiteSidebar, WidgetArea, type DetailWidgetCtx } from "@/components/sidebar/SiteSidebar";
import SidebarLayout from "@/components/layout/SidebarLayout";
import DetailPost from "@/components/resource/detail/DetailPost";
import DetailBanner from "@/components/resource/detail/DetailBanner";
import DetailTwocol from "@/components/resource/detail/DetailTwocol";
import DetailArticle from "@/components/resource/detail/DetailArticle";
import { PendingBanner, type DetailCtx } from "@/components/resource/detail/parts";
import { TYPE_LABEL } from "@/lib/display";
import { siteUrl } from "@/lib/site-url";
import { decodeSlug } from "@/lib/slug";
import { getSeoConfig, jsonLd, resolveSiteName } from "@/lib/seo-config";

type PageProps = { params: Promise<{ slug: string }> };

const SITE_ORIGIN = `${siteUrl()}/`;
const absUrl = (path: string) => new URL(path, SITE_ORIGIN).toString();

/** 详情页结构化数据：Article + BreadcrumbList（仅已发布 SFW 内容；图片/日期缺省时省略对应字段） */
function buildDetailLd(
  detail: NonNullable<ResourceDetail>,
  name: string,
): { article: object; breadcrumb: object } {
  const authorName = detail.author.name || detail.author.username;
  const itemListElement: object[] = [
    { "@type": "ListItem", position: 1, name, item: siteUrl() },
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
    publisher: { "@type": "Organization", name },
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
  // 页面 params 不解码（见 decodeSlug 说明），中文 slug 必须自己解一次
  const slug = decodeSlug((await params).slug);
  // 仅「slug 完全不存在」时 404：页面有 loading 流式壳，等 page 里再 notFound() 状态码已是 200。
  // 注意不能按 status 判断——草稿/待审的作者预览也走这里
  const exists = await prisma.resource.findUnique({ where: { slug }, select: { id: true } });
  if (!exists) notFound();
  // 与 page 同参（含 viewerId）：cache() 同请求去重，草稿预览也能拿到真实标题
  const session = await auth();
  const meId =
    typeof session?.user?.id === "string" && session.user.id ? session.user.id : undefined;
  const [r, seo] = await Promise.all([getResourceDetail(slug, meId), getSeoConfig()]);
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
    // 页级 keywords 用资源标签（百度/Yandex 参考；Google 忽略），覆盖根布局的全局关键词
    keywords: r.tags.map((t) => t.tag.name),
    alternates: { canonical: `/resources/${r.slug}` },
    openGraph: {
      // 页级 openGraph 不与根布局合并，siteName 需自带
      siteName: resolveSiteName(seo),
      title: r.title,
      description,
      type: "article",
      images: ogImages as string[],
    },
  };
}

export default async function ResourcePage({ params }: PageProps) {
  // 页面 params 不解码（见 decodeSlug 说明），中文 slug 必须自己解一次
  const slug = decodeSlug((await params).slug);
  const session = await auth();
  const me = session?.user;
  const meId = typeof me?.id === "string" && me.id ? me.id : undefined;
  const [detail, theme, myCollections] = await Promise.all([
    getResourceDetail(slug, meId),
    getTheme(),
    meId ? getCollections(meId) : Promise.resolve([]),
  ]);
  // 激励配置（请求级缓存，与 sidebar/首页共用一次查询）：只为详情页取打赏参数
  const incentive = await getIncentive();

  if (!detail) notFound();
  // 未发布内容仅作者/管理可见
  if (detail.status !== "PUBLISHED") {
    const isOwner = meId === detail.authorId;
    const isStaff = me?.role === "ADMIN" || me?.role === "MODERATOR";
    if (!isOwner && !isStaff) notFound();
  }
  // D9：NSFW 详情登录门 —— 已发布成人内容仅登录后可见，未登录一律 404（不进索引/不泄露图）
  if (detail.status === "PUBLISHED" && detail.nsfw && !meId) notFound();

  // 作者的主页背景：三个条件同时成立才铺 —— ① 作者设了图 ② 开关打开（默认开）③ 作者**现在**仍达等级。
  // 等级必须重算、不能信任「当初传得上来」：门槛与档位都在后台可改，作者也可能掉档；
  // 判定复用前台与设置页同一个 profileBgUnlocked()，口径只有一份。
  // 没设背景的作者（眼下是绝大多数）连这一次点数查询都不会发生 —— 短路在 getPointBalance 之前。
  let bgKey: string | null = null;
  if (detail.author.profileBgPcKey && detail.author.profileBgOnResource) {
    const authorPoints = await getPointBalance(detail.authorId);
    const unlocked = profileBgUnlocked(
      levelOf(authorPoints, incentive.levels),
      incentive.profile.bgMinLevel,
      incentive.enabled,
    );
    if (unlocked) bgKey = detail.author.profileBgPcKey;
  }

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
  const isPreview = detail.status !== "PUBLISHED";

  // 结构化数据仅对可收录内容输出（预览/草稿与 NSFW 均已 noindex）
  const seo = await getSeoConfig();
  const detailLd =
    seo.structuredData && !isPreview && !detail.nsfw
      ? buildDetailLd(detail, resolveSiteName(seo))
      : null;

  // 详情页正文槽位（上/中/下，仅已发布内容；中部节点传给模板插在描述与评论之间）
  const detailCtx: DetailWidgetCtx = {
    id: detail.id,
    type: detail.type,
    authorUsername: detail.author.username,
    categorySlug: detail.category?.slug ?? null,
    description: detail.description,
  };
  // 先解析真实侧栏内容再交给布局，游客只剩登录专属模块时不会占用空右栏。
  const rail =
    !isPreview
      ? await renderSiteSidebar({ theme, page: "detail", detail: detailCtx, authed: !!meId })
      : null;
  const hasSlot = (area: "detailTop" | "detailMiddle" | "detailBottom") =>
    theme.slots[area].some((w) => w.enabled);
  const topSlot =
    !isPreview && hasSlot("detailTop") ? (
      <WidgetArea theme={theme} area="detailTop" detail={detailCtx} authed={!!meId} />
    ) : null;
  const bottomSlot =
    !isPreview && hasSlot("detailBottom") ? (
      <WidgetArea theme={theme} area="detailBottom" detail={detailCtx} authed={!!meId} />
    ) : null;
  const middleSlot =
    !isPreview && hasSlot("detailMiddle") ? (
      <WidgetArea theme={theme} area="detailMiddle" detail={detailCtx} authed={!!meId} />
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

  // 提醒条与各模板内容列同为 max-w-7xl 居中（与导航栏、个人主页同宽），宽度一致
  const previewCls = "mx-auto max-w-7xl px-4 pt-8 sm:px-6";

  return (
    <SidebarLayout
      railWidth={theme.sidebar.width}
      rail={rail ?? undefined}
    >
      {/* 作者主页背景：铺满视口的最底层，fixed 脱离 grid 流、不参与布局。
          与个人主页共用同一个遮罩类 .profile-bg-pc（左右两侧渐显、中间留白），仅桌面端渲染。 */}
      {bgKey && (
        <div
          aria-hidden
          className="profile-bg-pc pointer-events-none fixed inset-0 -z-10 hidden bg-cover bg-center bg-no-repeat sm:block"
          style={{ backgroundImage: `url(${publicUrl(bgKey)})` }}
        />
      )}
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
      {topSlot && <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">{topSlot}</div>}
      {isPreview && (
        <div className={previewCls}>
          <PendingBanner ctx={ctx} />
        </div>
      )}
      {body}
      {bottomSlot && <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">{bottomSlot}</div>}
    </SidebarLayout>
  );
}
