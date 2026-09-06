"use client";

// 后台数据表格「每页条数」选择器：URL 驱动（?size=），切换时重置页码。
// 复用后台搜索条视觉（直角 + 品牌边框），与 DataTable/Pager 同族。

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SELECT_SM } from "@/lib/ui/cls";

export function PageSizeSelect({
  pageSize,
  options = [15, 30, 50, 100],
}: {
  pageSize: number;
  options?: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-500">
      每页
      <select
        value={String(pageSize)}
        onChange={(e) => {
          const params = new URLSearchParams(sp.toString());
          params.set("size", e.target.value);
          params.delete("page");
          const qs = params.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
        className={SELECT_SM}
        aria-label="每页条数"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
