import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getCollections, getRelated, getResourceDetail } from "@/lib/queries";
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

type PageProps = { params: Promise<{ slug: string }> };

const typeLabel: Record<string, string> = { GAME: "游戏", IMAGE: "图集", ARTICLE: "文章" };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  // 仅「slug 完全不存在」时 404：页面有 loading 流式壳，等 page 里再 notFound() 状态码已是 200。
  // 注意不能按 status 判断——草稿/待审的作者预览也走这里
  const exists = await prisma.resource.findUnique({ where: { slug }, select: { id: true } });
  if (!exists) notFound();
  // 与 page 同参（含 viewerId）：cache() 同请求去重，草稿预览也能拿到真实标题
  const session = await auth();
  const meId = typeof session?.user?.id === "string" && session.user.id ? session.user.id : undefined;
  const r = await getResourceDetail(slug, meId);
  if (!r || r.status !== "PUBLISHED") return { title: r?.title ?? "未发布内容", robots: { index: false } };

  const description = r.summary ?? `${r.author.name ?? "@" + r.author.username} 分享的${typeLabel[r.type] ?? "资源"}`;
  const ogImages = r.gallery[0] ? [r.gallery[0].bigUrl] : [];
  return {
    title: r.title,
    description,
    alternates: { canonical: `/resources/${r.slug}` },
    openGraph: {
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

  // 相关推荐只对已发布内容计算（草稿/待审不需要）
  const related = detail.status === "PUBLISHED" ? await getRelated(detail) : [];

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

  // 详情页正文槽位（上/中/下，仅已发布内容；中部节点传给模板插在描述与评论之间）
  const detailCtx: DetailWidgetCtx = {
    id: detail.id,
    type: detail.type,
    authorUsername: detail.author.username,
    categorySlug: detail.category?.slug ?? null,
  };
  const hasSlot = (area: "detailTop" | "detailMiddle" | "detailBottom") =>
    theme.slots[area].some((w) => w.enabled);
  const topSlot = !isPreview && hasSlot("detailTop") ? (
    <WidgetArea theme={theme} area="detailTop" detail={detailCtx} />
  ) : null;
  const bottomSlot = !isPreview && hasSlot("detailBottom") ? (
    <WidgetArea theme={theme} area="detailBottom" detail={detailCtx} />
  ) : null;
  const middleSlot = !isPreview && hasSlot("detailMiddle") ? (
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
        showSidebar ? (
          <SiteSidebar
            theme={theme}
            page="detail"
            detail={detailCtx}
          />
        ) : undefined
      }
    >
      {topSlot && (
        <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">{topSlot}</div>
      )}
      {isPreview && (
        <div className={previewCls}>
          <PendingBanner ctx={ctx} />
        </div>
      )}
      {body}
      {bottomSlot && (
        <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">{bottomSlot}</div>
      )}
    </SidebarLayout>
  );
}
