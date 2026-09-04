import type { ReactNode } from "react";

/** 小徽标：行内紧凑元信息标签（类型/计数/状态），后台列表与前台卡片通用 */
export default function MiniBadge({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <span className={`rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] ${strong ? "font-medium " : ""}text-neutral-500`}>
      {children}
    </span>
  );
}
