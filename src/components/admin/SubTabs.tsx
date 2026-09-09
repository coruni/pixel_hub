"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

// 页内分区 tab：合并页（站点配置=运行配置+SEO、站点布局=首页+全站）用它切换分区，避免页面过长。
// 两节随页面一次性渲染、仅显隐切换（hidden 属性）——表单/拖拽等未保存状态在切换间保留；
// tab 样式与 SiteLayoutManager 的 AREA_TABS（border-b-2 下边线式）保持一致。
export default function SubTabs({
  tabs,
  panels,
}: {
  tabs: { key: string; label: string }[];
  panels: Record<string, ReactNode>;
}) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-4 border-b border-neutral-200" role="tablist">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <Button
              key={t.key}
              type="button"
              role="tab"
              id={`subtab-${t.key}`}
              aria-selected={on}
              aria-controls={`subpanel-${t.key}`}
              onClick={() => setActive(t.key)}
              className={`-mb-px border-b-2 px-1 pb-2 pt-1 text-sm transition ${
                on
                  ? "border-brand-500 font-medium text-brand-700"
                  : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {t.label}
            </Button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.key}
          role="tabpanel"
          id={`subpanel-${t.key}`}
          aria-labelledby={`subtab-${t.key}`}
          hidden={t.key !== active}
        >
          {panels[t.key]}
        </div>
      ))}
    </div>
  );
}
