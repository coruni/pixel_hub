"use client";

import Link from "next/link";
import { List } from "lucide-react";

/**
 * 文章目录的单个锚点链接。
 * 独立为 Client Component 的原因：位于 <summary> 内时需要 onClick 阻止冒泡，
 * 否则点击链接会同时触发 <details> 折叠；而函数无法从 Server Component 传给 Link。
 */
export function TocLink({
  href,
  text,
  level,
  inSummary = false,
}: {
  href: string;
  text: string;
  level: number;
  inSummary?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={inSummary ? (event) => event.stopPropagation() : undefined}
      className="flex min-w-0 items-start gap-1.5 text-xs leading-5 text-neutral-600 transition hover:text-brand-700"
    >
      {level === 2 && <List size={11} className="mt-1 shrink-0 text-brand-500" aria-hidden />}
      <span className="line-clamp-2">{text}</span>
    </Link>
  );
}
