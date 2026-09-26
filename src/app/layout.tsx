import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import PageTracker from "@/components/layout/PageTracker";
import PresencePing from "@/components/layout/PresencePing";
import RealtimeBridge from "@/components/layout/RealtimeBridge";
import ColorModeSync from "@/components/layout/ColorModeSync";
import GlobalProfileBgLoader from "@/components/layout/GlobalProfileBgLoader";
import { auth } from "@/lib/auth";
import { fromDbColorMode } from "@/lib/color-mode";
import { siteUrl } from "@/lib/site-url";
import { getSeoConfig, jsonLd, resolveSiteName } from "@/lib/seo-config";

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeoConfig();
  const name = resolveSiteName(seo);
  const description =
    seo.defaultDescription || `分享与发现图片、游戏等数字资源的${name}平台`;
  // 站长平台验证码仅在后台配置了对应项时输出；msvalidate.01 同时覆盖 Bing 与 Yahoo
  const verification: Metadata["verification"] = {
    ...(seo.verifications.google ? { google: seo.verifications.google } : {}),
    ...(seo.verifications.yandex ? { yandex: seo.verifications.yandex } : {}),
    other: {
      ...(seo.verifications.bing ? { "msvalidate.01": seo.verifications.bing } : {}),
      ...(seo.verifications.baidu
        ? { "baidu-site-verification": seo.verifications.baidu }
        : {}),
    },
  };
  return {
    title: { default: name, template: `%s · ${name}` },
    description,
    // meta keywords：Google 忽略，百度/Yandex 仍参考；未配置不输出
    keywords: seo.keywords || undefined,
    metadataBase: new URL(siteUrl()),
    openGraph: {
      type: "website",
      siteName: name,
      locale: seo.ogLocale,
      title: { default: name, template: `%s · ${name}` },
      description,
    },
    twitter: { card: "summary_large_image" },
    verification,
  };
}

// 首帧同步配色（放 body 最前、阻塞渲染执行，防止暗色闪白）。
// 偏好只从 <html data-color-mode> 读 —— 服务端已按「已登录取账号值 / 游客取 system」写好，
// 这里只把「偏好」翻译成「最终 class」：system 时现问 matchMedia，light/dark 时直接用。
// 游客没有账号也没有本地存储，因此天然跟随浏览器配色；系统切换由 ColorModeSync 接管。
const themeInitScript = `try{var e=document.documentElement,m=e.getAttribute("data-color-mode")||"system",d=m==="dark"||(m!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(err){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [session, seo] = await Promise.all([auth(), getSeoConfig()]);
  const name = resolveSiteName(seo);
  const websiteLd = seo.structuredData
    ? jsonLd({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name,
        url: siteUrl(),
        inLanguage: "zh-CN",
        potentialAction: {
          "@type": "SearchAction",
          target: `${siteUrl()}/browse?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      })
    : null;
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
      // 游客取 system（跟随浏览器）；已登录取账号上的偏好。首帧脚本据此上 class
      data-color-mode={fromDbColorMode(session?.user?.colorMode)}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-neutral-900">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {websiteLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: websiteLd }}
          />
        )}
        <ColorModeSync />
        <GlobalProfileBgLoader />
        <PageTracker />
        <PresencePing signedIn={Boolean(session?.user)} />
        <RealtimeBridge signedIn={Boolean(session?.user)} />
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer
          name={name}
          footerText={seo.footerText}
          icp={seo.icp}
          contactEmail={seo.contactEmail}
        />
      </body>
    </html>
  );
}
