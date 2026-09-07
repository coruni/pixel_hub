import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import PageTracker from "@/components/layout/PageTracker";
import PresencePing from "@/components/layout/PresencePing";
import { auth } from "@/lib/auth";
import { siteUrl } from "@/lib/site-url";
import { getSeoConfig, jsonLd, resolveSiteName } from "@/lib/seo-config";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

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

// 首帧同步主题（放 body 前、阻塞渲染执行，防止暗色闪白）：localStorage 未设置时跟随系统
const themeInitScript = `try{var t=localStorage.getItem("theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}`;

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
          target: `${siteUrl()}/search?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      })
    : null;
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
        <PageTracker />
        <PresencePing signedIn={Boolean(session?.user)} />
        <Navbar />
        <main className="flex-1">{children}</main>
        <footer className="mt-10 border-t border-brand-200 py-8 text-center text-xs text-neutral-400">
          <p>
            <a href="/rules" className="hover:text-neutral-900">
              社区规则
            </a>
            <span className="mx-2">·</span>
            {name} · 分享与发现 · 请遵守平台规则，勿上传侵权与违法内容
          </p>
        </footer>
      </body>
    </html>
  );
}
