"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

// 页内分区 tab：合并页（站点配置=运行配置+SEO、站点布局=首页+全站）用它切换分区，避免页面过长。
// 两节随页面一次性渲染、仅显隐切换（hidden 属性）——表单/拖拽等未保存状态在切换间保留；
// 使用独立的分段式 tab，让长页面的当前上下文更明确。
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
      <div
        className="mb-5 inline-flex max-w-full gap-1 overflow-x-auto border border-neutral-200 bg-neutral-100 p-1"
        role="tablist"
      >
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
              className={`shrink-0 px-4 py-2 text-sm transition ${
                on
                  ? "border border-brand-200 bg-surface font-medium text-brand-700"
                  : "border border-transparent text-neutral-500 hover:bg-surface/70 hover:text-neutral-800"
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
