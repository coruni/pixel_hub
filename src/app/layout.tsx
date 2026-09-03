import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import PageTracker from "@/components/layout/PageTracker";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
 <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
 <body className="flex min-h-full flex-col bg-background text-neutral-900">
 <PageTracker />
 <Navbar />
 <main className="flex-1">{children}</main>
 <footer className="mt-10 border-t border-brand-200 py-8 text-center text-xs text-neutral-400">
 {siteName()} · 分享与发现 · 请遵守平台规则，勿上传侵权与违法内容
 </footer>
 </body>
 </html>
 );
}
