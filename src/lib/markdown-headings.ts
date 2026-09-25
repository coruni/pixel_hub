export type ArticleHeading = {
  level: 2 | 3 | 4;
  text: string;
  id: string;
};

/**
 * 从 Markdown 正文提取文章目录标题。
 * 只收录 h2-h4：h1 通常已经由资源标题承担，h5/h6 在窄侧栏里层级过深。
 * 代码围栏中的井号不参与解析，避免代码示例误出现在目录里。
 */
export function extractArticleHeadings(markdown: string): ArticleHeading[] {
  const headings: ArticleHeading[] = [];
  let inFence = false;
  let headingIndex = 0;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(?: {0,3})(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;

    const level = match[1].length;
    const text = inlineText(match[2]);
    const id = `article-heading-${headingIndex}`;
    headingIndex += 1;
    if (level >= 2 && level <= 4 && text) {
      headings.push({ level: level as 2 | 3 | 4, text, id });
    }
  }
  return headings;
}

/** 与目录文本保持一致的轻量 Markdown 行内语法清理，不渲染也不执行 HTML。 */
function inlineText(value: string): string {
  return value
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[ *_~]/g, "")
    .trim();
}
