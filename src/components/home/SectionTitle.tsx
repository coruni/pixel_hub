import type { ReactNode } from "react";

/** 首页板块标题：中性大标题 + 紫→青渐变小竖条点缀（整体保持中性配色，仅少量品牌点缀） */
export default function SectionTitle({
  children,
  as: Tag = "h2",
  className = "mb-4",
}: {
  children: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <Tag className={`flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-neutral-900 ${className}`}>
      <span className="h-6 w-1.5 shrink-0 rounded-none bg-brand-500" aria-hidden />
      {children}
    </Tag>
  );
}
