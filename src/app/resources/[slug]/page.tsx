import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getCollections, getRelated, getResourceDetail } from "@/lib/queries";
import { parseMeta } from "@/lib/meta";
import { getTheme, detailTemplateFor } from "@/lib/site";
import { sidebarVisible } from "@/lib/site-config";
import SiteSidebar from "@/components/sidebar/SiteSidebar";
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
  const r = await getResourceDetail(slug);
  if (!r || r.status !== "PUBLISHED") return { title: "未找到资源", robots: { index: false } };

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

  const body =
    template === "banner" ? (
      <DetailBanner ctx={ctx} />
    ) : template === "twocol" ? (
      <DetailTwocol ctx={ctx} />
    ) : template === "article" ? (
      <DetailArticle ctx={ctx} />
    ) : (
      <DetailPost ctx={ctx} />
    );

  // 提醒条与各模板内容列同为 max-w-6xl 居中，宽度一致
  const previewCls = "mx-auto max-w-6xl px-4 pt-6 sm:px-6";

  return (
    <SidebarLayout railWidth={theme.sidebar.width} rail={showSidebar ? <SiteSidebar theme={theme} /> : undefined}>
      {isPreview && (
        <div className={previewCls}>
          <PendingBanner ctx={ctx} />
        </div>
      )}
      {body}
    </SidebarLayout>
  );
}
