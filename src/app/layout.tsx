import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import PageTracker from "@/components/layout/PageTracker";
import PresencePing from "@/components/layout/PresencePing";
import ThemeToggle from "@/components/layout/ThemeToggle";
import { auth } from "@/lib/auth";
import { siteUrl, siteName } from "@/lib/site-url";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
 title: { default: siteName(), template: `%s · ${siteName()}` },
 description: `分享与发现图片、游戏等数字资源的${siteName()}平台`,
 metadataBase: new URL(siteUrl()),
 openGraph: {
  type: "website",
  siteName: siteName(),
  title: { default: siteName(), template: `%s · ${siteName()}` },
  description: `分享与发现图片、游戏等数字资源的${siteName()}平台`,
 },
 twitter: { card: "summary_large_image" },
};

// 首帧同步主题（放 body 前、阻塞渲染执行，防止暗色闪白）：localStorage 未设置时跟随系统
const themeInitScript = `try{var t=localStorage.getItem("theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
 const session = await auth();
 return (
 <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
 <body className="flex min-h-full flex-col bg-background text-neutral-900">
 <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
 <PageTracker />
 <PresencePing signedIn={Boolean(session?.user)} />
 <Navbar />
 <main className="flex-1">{children}</main>
 <footer className="mt-10 border-t border-brand-200 py-8 text-center text-xs text-neutral-400">
 {siteName()} · 分享与发现 · 请遵守平台规则，勿上传侵权与违法内容
 </footer>
 </body>
 </html>
 );
}
