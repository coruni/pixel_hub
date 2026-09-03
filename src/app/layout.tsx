import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
 title: { default: "资源社区", template: "%s · 资源社区" },
 description: "分享与发现图片、游戏等数字资源的社区平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
 <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
 <body className="flex min-h-full flex-col bg-background text-neutral-900">
 <Navbar />
 <main className="flex-1">{children}</main>
 <footer className="mt-10 border-t border-brand-200 py-8 text-center text-xs text-neutral-400">
 资源社区 · 分享与发现 · 请遵守平台规则，勿上传侵权与违法内容
 </footer>
 </body>
 </html>
 );
}
