"use client";

import { LABEL_STRONG } from "@/lib/ui/cls";

/** 多选 chip 选择器：后台编辑器通用（分类/标签挑选），空选项时展示占位提示 */
export default function ChipPicker({
  label,
  options,
  selected,
  onChange,
  empty = "暂无可选项",
}: {
  label: string;
  options: { key: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  empty?: string;
}) {
  const set = new Set(selected);
  return (
    <div>
      <label className={LABEL_STRONG}>{label}</label>
      {options.length === 0 ? (
        <p className="rounded-none border-2 border-dashed border-brand-300 bg-surface px-3 py-3 text-xs text-neutral-400">
          {empty}
        </p>
      ) : (
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto rounded-none border border-brand-200 bg-surface p-2">
          {options.map((o) => {
            const on = set.has(o.key);
            return (
              <button
                key={o.key}
                type="button"
                onClick={() =>
                  onChange(on ? selected.filter((s) => s !== o.key) : [...selected, o.key])
                }
                className={`rounded-none border px-2.5 py-1 text-xs transition ${
                  on
                    ? "border-brand-500 bg-brand-500 text-white"
                    : "border-neutral-200 bg-surface text-neutral-600 hover:border-brand-500"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
