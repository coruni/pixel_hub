import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import type { HTMLAttributes, ReactNode } from "react";

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
 * 全站统一的 Markdown 渲染（可在服务端或客户端组件中使用；react-markdown 为纯渲染、无 hooks）。
 * 安全：react-markdown 默认不渲染原始 HTML；javascript: 等危险协议会被其默认 transform 剥离。
 *
 * 用法：外层用 <div className="md-body …"> 包裹以套用 globals.css 排版。
 * - 站内绝对路径(/…)链接 → next/link，走客户端导航
 * - http(s) 外链 → 新窗口 + rel=noopener noreferrer
 * - 其余(锚点/#hash、mailto:)维持默认同页打开
 */
export default function Markdown({ children }: { children: string }) {
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
  };

  return (
    <ReactMarkdown components={components} remarkPlugins={[remarkBrAsBreak]}>
      {children}
    </ReactMarkdown>
  );
}
