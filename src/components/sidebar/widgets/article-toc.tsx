import Link from "next/link";
import { List } from "lucide-react";
import { extractArticleHeadings } from "@/lib/markdown-headings";
import { WidgetShell } from "../shell";
import type { SidebarWidget } from "@/lib/site-config";
import type { DetailWidgetCtx } from "../shell";

/**
 * 文章目录：只在文章详情页且正文至少有 3 个 h2-h4 标题时显示。
 * 标题 id 与 Markdown 渲染器共用 article-heading-N 协议，点击后由浏览器原生定位，
 * 不引入客户端状态，也不会为短正文制造空模块。
 */
export function renderArticleToc(w: SidebarWidget, detail?: DetailWidgetCtx) {
  if (!detail || detail.type !== "ARTICLE") return null;
  const headings = extractArticleHeadings(detail.description);
  if (headings.length < 3) return null;

  return (
    <WidgetShell title={w.title || "文章目录"}>
      <nav aria-label="文章目录">
        <ol className="space-y-1 border-l border-brand-200 pl-3">
          {headings.map((heading) => (
            <li key={heading.id} className={heading.level === 2 ? "" : "pl-2"}>
              <Link
                href={`#${heading.id}`}
                className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-neutral-600 transition hover:text-brand-700"
              >
                {heading.level === 2 && <List size={11} className="mt-1 shrink-0 text-brand-500" aria-hidden />}
                <span className="line-clamp-2">{heading.text}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>
    </WidgetShell>
  );
}
