import type { ReactNode } from "react";
import SectionTitle from "./SectionTitle";

/** 首页板块外壳：统一的居中容器 + 可选标题（各 blocks/* 组件共用） */
export default function BlockShell({
  title,
  className = "mt-8",
  children,
}: {
  title: string | null;
  /** 外层 section 的附加类（默认 mt-8，hero 用 pt-8、tags 加 pb-8 等） */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {title && <SectionTitle>{title}</SectionTitle>}
        {children}
      </div>
    </section>
  );
}
