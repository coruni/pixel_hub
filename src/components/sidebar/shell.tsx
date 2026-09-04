import type { ReactNode } from "react";

/** 侧边栏组件容器样式（直角卡片） */
export const widgetCls = "rounded-none border border-brand-200 bg-surface p-4";

/** 详情页专用组件的取数上下文（当前资源） */
export type DetailWidgetCtx = {
  id: string;
  type: "GAME" | "IMAGE" | "ARTICLE";
  authorUsername: string;
  categorySlug: string | null;
};

/** 组件外壳：小标题 + 内容 */
export function WidgetShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={widgetCls}>
      <h3 className="mb-3 text-xs font-semibold tracking-wider text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}
