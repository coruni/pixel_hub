"use client";

// 账户设置页 tab 切换：客户端管 active，server page 把每个 panel 作为 React 节点传入。
// 复刻后台 SiteLayoutManager 的 tablist 风格（border-b 下划线激活态）。
//
// 窄屏（320 / 375px）下 tab 总宽超过 max-w-xl 容器的可用宽度（8 个 tab 时约 480px）：
// 这里不换行，改成横向滚动（shrink-0 + overflow-x-auto），并隐藏滚动条——
// 否则滚动条会占掉 tab 行下方约 10px，把下划线与 track 线错开。
// 下划线压线沿用 -mb-px，但必须挂在这层滚动容器而不是按钮上：滚动容器会裁掉自己的
// 溢出（overflow-y 随 overflow-x 一起计算为 auto），挂在按钮上那 1px 会被裁掉。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

type Tab = { key: string; label: string; panel: ReactNode };

export default function SettingsTabs({ tabs, initial }: { tabs: Tab[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key ?? "");
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  const listRef = useRef<HTMLDivElement | null>(null);

  // 深链进来自带 ?tab=account 时，激活项可能在滚动区之外——把它带回可视范围，
  // block: "nearest" 保证只横向滚动、不带着整页上下跳。
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`#settings-tab-${active}`);
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [active]);

  return (
    <div className="mt-6">
      <div className="border-b border-neutral-200">
        <div
          ref={listRef}
          role="tablist"
          aria-label="账户设置分组"
          className="-mb-px flex scrollbar-none gap-1 overflow-x-auto"
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
                className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
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
