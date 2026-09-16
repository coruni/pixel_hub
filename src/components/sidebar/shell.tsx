import type { ReactNode } from "react";
import type { ContentType } from "@/lib/display";

/** 侧边栏组件容器样式（直角卡片）。
 *  min-w-0 必需：作为 grid/flex 子项时默认 min-width:auto，内部网格（如「热门内容」双列卡）
 *  会把卡片撑破所在列，表现为内容溢出容器。 */
export const widgetCls = "min-w-0 rounded-none border border-brand-200 bg-surface p-4";

/** 详情页专用组件的取数上下文（当前资源） */
export type DetailWidgetCtx = {
  id: string;
  type: ContentType;
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
