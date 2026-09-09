"use client";

// 账户设置页 tab 切换：客户端管 active，server page 把每个 panel 作为 React 节点传入。
// 复刻后台 SiteLayoutManager 的 tablist 风格（border-b 下划线激活态）。
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

type Tab = { key: string; label: string; panel: ReactNode };

export default function SettingsTabs({ tabs, initial }: { tabs: Tab[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key ?? "");
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div className="mt-6">
      <div
        className="flex flex-wrap gap-1 border-b border-neutral-200"
        role="tablist"
        aria-label="账户设置分组"
      >
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <Button
              key={t.key}
              type="button"
              role="tab"
              id={`settings-tab-${t.key}`}
              aria-selected={on}
              aria-controls="settings-panel"
              onClick={() => setActive(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
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
      <div
        role="tabpanel"
        id="settings-panel"
        aria-labelledby={`settings-tab-${active}`}
        className="focus:outline-none"
      >
        <div className="space-y-4">{current?.panel}</div>
      </div>
    </div>
  );
}