import type { CSSProperties, ReactNode } from "react";

// 主栏 + 可选右栏（侧边栏）外壳。带侧栏时整页容器收窄为 max-w-7xl，
// 移动端右栏折叠到内容下方；不带侧栏则原样渲染 children（不改变既有版式）。
//
// 外层只加**右侧** `lg:pr-6`：主栏的 children（各模板根容器）自带 `px-4 sm:px-6`，
// 内容距容器边界已有 24px；而 rail 在 lg 下是 `px-0`，容器本身又没有内边距 —— 侧栏会
// **贴到容器右边缘**，比主栏内容多探出 24px（主栏还是 6xl 时靠两侧 64px 留白遮住了，
// 改成 7xl 后就露出来了）。左侧不加：那一侧的 24px 已由主栏 children 提供，两边都加
// 会让主栏内容双重内缩。
export default function SidebarLayout({
  rail,
  railWidth,
  children,
}: {
  rail?: ReactNode;
  railWidth?: number;
  children: ReactNode;
}) {
  if (!rail) return <>{children}</>;

  return (
    <div className="mx-auto max-w-7xl lg:pr-6">
      <div
        className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_var(--rail)]"
        style={{ "--rail": `${railWidth ?? 320}px` } as CSSProperties}
      >
        <div className="min-w-0">{children}</div>
        {/* 移动端 rail 折叠到内容下方：补左右/底部边距，与主列自带 px-4 对齐；桌面端回零。
            min-w-0 必需：grid 子项默认 min-width:auto，rail 内的模块（如「热门内容」网格）
            会把这一列撑破 --rail 定宽，表现为内容溢出容器。 */}
        <div className="min-w-0 px-4 pb-6 lg:px-0 lg:pb-0">{rail}</div>
      </div>
    </div>
  );
}
