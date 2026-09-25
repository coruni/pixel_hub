import { ChevronDown } from "lucide-react";
import { extractArticleHeadings, type ArticleHeading } from "@/lib/markdown-headings";
import { WidgetShell } from "../shell";
import { TocLink } from "./toc-link";
import type { SidebarWidget } from "@/lib/site-config";
import type { DetailWidgetCtx } from "../shell";

type TocNode = ArticleHeading & { children: TocNode[] };

/** 按标题层级构造树：h2 为根，h3/h4 自动缩进到最近的上级标题下。 */
function buildTree(headings: ArticleHeading[]): TocNode[] {
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const heading of headings) {
    const node: TocNode = { ...heading, children: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.level >= node.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/** 只向客户端组件传递可序列化的原始值，避免序列化整棵子树。 */
function TocHeadingLink({ heading, inSummary = false }: { heading: TocNode; inSummary?: boolean }) {
  return (
    <TocLink
      href={`#${heading.id}`}
      text={heading.text}
      level={heading.level}
      inSummary={inSummary}
    />
  );
}

function TocNodes({ nodes }: { nodes: TocNode[] }) {
  return (
    <ol className="space-y-1 border-l border-brand-200 pl-3">
      {nodes.map((heading) => (
        <li key={heading.id}>
          {heading.children.length > 0 ? (
            <details open className="group">
              <summary className="flex cursor-pointer list-none items-start gap-1 [&::-webkit-details-marker]:hidden">
                <ChevronDown
                  size={13}
                  className="mt-1 shrink-0 text-neutral-400 transition-transform group-open:rotate-180"
                  aria-hidden
                />
                <TocHeadingLink heading={heading} inSummary />
              </summary>
              <div className="mt-1 pl-3">
                <TocNodes nodes={heading.children} />
              </div>
            </details>
          ) : (
            <TocHeadingLink heading={heading} />
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * 文章目录：只在文章详情页且正文至少有 3 个 h2-h4 标题时显示。
 * 标题 id 与 Markdown 渲染器共用 article-heading-N 协议，点击后由浏览器原生定位。
 * 每个有子标题的章节使用原生 details 折叠，h3/h4 通过嵌套列表自动缩进。
 */
export function renderArticleToc(w: SidebarWidget, detail?: DetailWidgetCtx) {
  if (!detail || detail.type !== "ARTICLE") return null;
  const headings = extractArticleHeadings(detail.description);
  if (headings.length < 3) return null;

  return (
    <WidgetShell title={w.title || "文章目录"}>
      <nav aria-label="文章目录">
        <TocNodes nodes={buildTree(headings)} />
      </nav>
    </WidgetShell>
  );
}
