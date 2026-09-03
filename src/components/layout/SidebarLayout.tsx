import type { CSSProperties, ReactNode } from "react";

// 主栏 + 可选右栏（侧边栏）外壳。带侧栏时整页容器收窄为 max-w-7xl，
// 移动端右栏折叠到内容下方；不带侧栏则原样渲染 children（不改变既有版式）。
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
    <div className="mx-auto max-w-7xl">
      <div
        className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_var(--rail)]"
        style={{ "--rail": `${railWidth ?? 320}px` } as CSSProperties}
      >
        <div className="min-w-0">{children}</div>
        {/* 移动端 rail 折叠到内容下方：补左右/底部边距，与主列自带 px-4 对齐；桌面端回零 */}
        <div className="px-4 pb-6 lg:px-0 lg:pb-0">{rail}</div>
      </div>
    </div>
  );
}
