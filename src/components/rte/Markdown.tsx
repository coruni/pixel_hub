"use client";

import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";

const EXTERNAL = /^https?:\/\//i;

/**
 * 全站统一的 Markdown 渲染（client 边界，服务端组件不能直接跑 react-markdown 时的入口）。
 * 安全：react-markdown 默认不渲染原始 HTML；javascript: 等危险协议会被其默认 transform 剥离。
 *
 * 用法：外层用 <div className="md-body …"> 包裹以套用 globals.css 排版。
 * - 站内绝对路径(/…)链接 → next/link，走客户端导航
 * - http(s) 外链 → 新窗口 + rel=noopener noreferrer
 * - 其余(锚点/#hash、mailto:)维持默认同页打开
 */
export default function Markdown({ children }: { children: string }) {
  const components: Components = {
    a({ href = "", children }) {
      if (EXTERNAL.test(href)) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }
      if (href.startsWith("/")) {
        return <Link href={href}>{children}</Link>;
      }
      return <a href={href}>{children}</a>;
    },
  };

  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
}
