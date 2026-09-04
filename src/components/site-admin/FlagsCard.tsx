"use client";

import { useState } from "react";
import type { Theme } from "@/lib/site-config";
import { updateSidebarFlagsAction } from "@/lib/actions/site";
import { PAGE_LABELS, type RunFn } from "./shared";

/** 侧边栏在哪些页面显示（showOn）+ sticky / 栏宽外观 */
export default function FlagsCard({
  theme,
  pending,
  run,
}: {
  theme: Theme;
  pending: boolean;
  run: RunFn;
}) {
  const [sticky, setSticky] = useState(theme.sidebar.sticky);
  const [width, setWidth] = useState(theme.sidebar.width);

  const commit = (patch: { sticky?: boolean; width?: number }) => {
    run(() => updateSidebarFlagsAction(patch));
  };

  return (
    <section className="rounded-none border border-brand-200 bg-surface p-5">
      <h2 className="text-base font-semibold text-neutral-900">侧边栏在哪些页面显示</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {PAGE_LABELS.map((p) => {
          const on = theme.sidebar.showOn[p.key];
          return (
            <button
              key={p.key}
              type="button"
              disabled={pending}
              onClick={() => run(() => updateSidebarFlagsAction({ showOn: { [p.key]: !on } }))}
              className={`flex items-start gap-2 rounded-none border px-3.5 py-3 text-left transition disabled:opacity-50 ${
                on
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-neutral-200 bg-surface hover:border-brand-500"
              }`}
            >
              <span
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-none border text-[10px] ${on ? "border-white bg-surface text-neutral-900" : "border-neutral-300 text-transparent"}`}
              >
                ✓
              </span>
              <span>
                <span className="block text-sm font-medium">{p.label}</span>
                <span className={`block text-xs ${on ? "text-white/70" : "text-neutral-400"}`}>
                  {p.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-5 border-t border-neutral-100 pt-4">
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={sticky}
            disabled={pending}
            onChange={(e) => {
              setSticky(e.target.checked);
              commit({ sticky: e.target.checked });
            }}
            className="h-4 w-4 accent-brand-500"
          />
          侧边栏工具固定（sticky，随滚动吸附）
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          栏宽
          <input
            type="number"
            min={260}
            max={420}
            step={10}
            value={width}
            disabled={pending}
            onChange={(e) => setWidth(Number(e.target.value) || 320)}
            onBlur={() => {
              const w = Math.max(260, Math.min(420, width));
              setWidth(w);
              if (w !== theme.sidebar.width) commit({ width: w });
            }}
            className="w-20 rounded-none border border-brand-200 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
          />
          px
        </label>
      </div>
    </section>
  );
}
