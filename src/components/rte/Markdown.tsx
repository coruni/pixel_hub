import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

const EXTERNAL = /^https?:\/\//i;

/** 裸写的换行标签：<br> / <br/> / <br />（大小写不限） */
const BR_TAG = /<br\s*\/?>/i;
const BR_SPLIT = /<br\s*\/?>/gi;

type HeadingProps = HTMLAttributes<HTMLHeadingElement> & { children?: ReactNode };

function headingRenderer(Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6", nextIndex: () => number) {
  return function Heading({ children, className, ...props }: HeadingProps) {
    return (
      <Tag
        {...props}
        id={`article-heading-${nextIndex()}`}
        className={["scroll-mt-24", className].filter(Boolean).join(" ")}
      >
        {children}
      </Tag>
    );
  };
}

type MdNode = { type: string; value?: unknown; children?: MdNode[] };

/**
 * 把正文里裸写的 <br> 转成 markdown 硬换行。
 *
 * 为什么必须转：react-markdown 默认不渲染原始 HTML（安全默认，不能为了 <br> 放开整片 HTML），
 * 于是 `<br />` 会被当成普通文本转义成 `&lt;br /&gt;` —— 前台正文里直接显示「<br />」字样。
 * 常见来源是从别处粘贴/迁移的内容（Milkdown 自己按 Shift+Enter 产出的是 `\` + 换行，不受影响）。
 * 作者写它的本意就是换行，转成 mdast 的 break 节点即可，其余 HTML 一律照旧不渲染。
 */
function remarkBrAsBreak() {
  return (tree: MdNode) => {
    convert(tree);
  };
}

function convert(node: MdNode): void {
  if (!Array.isArray(node.children)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "html" && typeof child.value === "string" && BR_TAG.test(child.value)) {
      // 一段 html 字符串里可能夹着文本，按标签切成 [文本, break, 文本, ...]
      child.value.split(BR_SPLIT).forEach((part, i) => {
        if (i > 0) next.push({ type: "break" });
        if (part) next.push({ type: "text", value: part });
      });
      continue;
    }
    convert(child);
    next.push(child);
  }
  node.children = next;
}


/**
 * 可缩放图片（zoomable 模式下的 img 渲染器）：外面包一层 <button>，
 * 由 <MarkdownImages> 委托点击后打开 ImageViewer。
 *
 * 为什么包 <button> 而不是给 <img> 挂 onClick：Tab 聚焦 + Enter/Space 与 focus-visible
 * 直接可用，且与评论图片（同样用 button 包图）保持同一套可访问性做法；
 * 图标/图片按钮必须带可读名称，所以把 alt 带进 aria-label。
 */
function ZoomableImage({ src, alt, title }: ComponentProps<"img">) {
  if (typeof src !== "string" || !src) return null;
  const name = alt?.trim();
  return (
    <button
      type="button"
      data-zoomable
      aria-label={name ? `查看大图：${name}` : "查看大图"}
      className="inline-flex max-w-full cursor-zoom-in rounded-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt ?? ""} title={title} />
    </button>
  );
}

/**
 * 全站统一的 Markdown 渲染（可在服务端或客户端组件中使用；react-markdown 为纯渲染、无 hooks）。
 * 安全：react-markdown 默认不渲染原始 HTML；javascript: 等危险协议会被其默认 transform 剥离。
 *
 * 用法：外层用 <div className="md-body …"> 包裹以套用 globals.css 排版。
 * - 站内绝对路径(/…)链接 → next/link，走客户端导航
 * - http(s) 外链 → 新窗口 + rel=noopener noreferrer
 * - 其余(锚点/#hash、mailto:)维持默认同页打开
 *
 * zoomable：正文图片变为「点击查看大图」入口（需外层套 <MarkdownImages> 才生效，
 * 二者是一对——单独的图片按钮点了没反应，所以默认关闭，只由需要查看器的正文开启）。
 */
export default function Markdown({
  children,
  zoomable = false,
}: {
  children: string;
  zoomable?: boolean;
}) {
  let headingIndex = 0;
  const nextHeadingIndex = () => headingIndex++;
  const components: Components = {
    h1: headingRenderer("h1", nextHeadingIndex),
    h2: headingRenderer("h2", nextHeadingIndex),
    h3: headingRenderer("h3", nextHeadingIndex),
    h4: headingRenderer("h4", nextHeadingIndex),
    h5: headingRenderer("h5", nextHeadingIndex),
    h6: headingRenderer("h6", nextHeadingIndex),
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
    ...(zoomable ? { img: ZoomableImage } : {}),
  };

  return (
    <ReactMarkdown components={components} remarkPlugins={[remarkBrAsBreak]}>
      {children}
    </ReactMarkdown>
  );
}
