"use client";

// 创作者激励后台配置页的共用表单件（区块外壳 / 数字行 / 开关行 / 分段单选 / 等级行编辑器）。
// 与「上传限制」页同一视觉语言：border-brand-200 + bg-surface + 直角 + 左侧说明右侧控件。
// 单独成文件是为了让 IncentiveManager 只负责「配置分组与保存」，两边都留在可读行数内。
import type { ReactNode } from "react";
import { ArrowUp, Plus, Trash2, type LucideIcon } from "lucide-react";
import { INPUT_SM } from "@/lib/ui/cls";
import { Button } from "@/components/ui/Button";

function HintDetails({ children }: { children: ReactNode }) {
  return (
    <details className="mt-1 text-[11px] leading-4 text-neutral-400">
      <summary className="w-fit cursor-pointer list-none underline decoration-dotted underline-offset-2">
        说明
      </summary>
      <div className="mt-1 max-w-prose">{children}</div>
    </details>
  );
}

/** 区块外壳：图标 + 标题 + 一句话说明 + 内容 */
export function Section({
  icon: Icon,
  title,
  desc,
  badge,
  children,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  /** 右上角小徽标（如「已生效」「结算功能上线后生效」） */
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden border border-brand-200 bg-surface ${className}`}>
      <div className="border-b border-brand-100 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand-50 text-brand-600">
            <Icon size={18} strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
              {badge}
            </div>
            <p className="mt-1 text-xs leading-5 text-neutral-500">{desc}</p>
          </div>
        </div>
      </div>
      <div className="divide-y divide-brand-100">{children}</div>
    </section>
  );
}

/** 行容器：左侧说明、右侧控件；窄屏控件换行到下一行并占满宽度 */
export function Row({
  htmlFor,
  label,
  range,
  hint,
  children,
}: {
  htmlFor?: string;
  label: string;
  /** 范围徽标（如「0–10000 分」） */
  range?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-start sm:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label className="text-xs font-medium text-neutral-700" htmlFor={htmlFor}>
            {label}
          </label>
          {range && (
            <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
              {range}
            </span>
          )}
        </div>
        {hint && <HintDetails>{hint}</HintDetails>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** 数字行（值以字符串保存，允许中途为空，提交时由服务端钳制/校验） */
export function NumRow({
  id,
  label,
  range,
  hint,
  value,
  onChange,
  min,
  max,
  suffix,
  disabled,
}: {
  id: string;
  label: string;
  range?: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  /** 输入框右侧单位 */
  suffix?: string;
  /** 该项当前是否不参与生效（如依赖的开关未开）：真禁用而不是遮罩，键盘也不会误入 */
  disabled?: boolean;
}) {
  return (
    <Row htmlFor={id} label={label} range={range} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          step={1}
          min={min}
          max={max}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_SM} w-full text-right tabular-nums disabled:opacity-50 sm:text-left`}
        />
        {suffix && (
          <span className="shrink-0 text-[11px] text-neutral-400" aria-hidden>
            {suffix}
          </span>
        )}
      </div>
    </Row>
  );
}

/**
 * 下拉行：选项多到分段按钮放不下时用（如等级档位）。
 * 与 NumRow 同宽同布局；值一律是字符串 —— 数字型字段（等级序号）由调用方自行转换。
 */
export function SelectRow({
  id,
  label,
  range,
  hint,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  label: string;
  range?: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Row htmlFor={id} label={label} range={range} hint={hint}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_SM} w-full disabled:opacity-50`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** 开关行：整行是 label，点击即切换 */
export function SwitchRow({
  id,
  label,
  range,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  range?: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <label
        htmlFor={id}
        className={`flex items-start gap-3 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded-none border border-brand-300 accent-brand-500 outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-neutral-700">{label}</span>
            {range && (
              <span className="rounded-none bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
                {range}
              </span>
            )}
          </span>
          {hint && <HintDetails>{hint}</HintDetails>}
        </span>
      </label>
    </div>
  );
}

/** 分段单选：2–4 个互斥选项，横排等分（选中态靠边框 + 底色 + 文字三重表达）。
 *  单独撑满整行 —— 塞进 Row 的 10rem 控件列会挤成竖排。 */
export function SegmentedRow<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: T;
  options: { value: T; label: string; note?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <p className="text-xs font-medium text-neutral-700">{label}</p>
      {hint && <HintDetails>{hint}</HintDetails>}
      <div
        className="mt-2 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={`flex min-h-10 min-w-0 flex-col justify-center border px-2 py-1.5 text-center transition focus-visible:ring-2 focus-visible:ring-brand-400 ${
                active
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-400"
              }`}
            >
              <span className="truncate text-xs font-medium">{o.label}</span>
              {o.note && <span className="mt-0.5 truncate text-[10px] text-neutral-400">{o.note}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 文本行（短字符串，如代币名与符号） */
export function TextRow({
  id,
  label,
  range,
  hint,
  value,
  onChange,
  maxLength,
}: {
  id: string;
  label: string;
  range?: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
}) {
  return (
    <Row htmlFor={id} label={label} range={range} hint={hint}>
      <input
        id={id}
        type="text"
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_SM} w-full`}
      />
    </Row>
  );
}

/** 多选切换行（如启用哪几个榜单周期）：每个选项独立开关，至少保留一个由调用方负责 */
export function ToggleRow<T extends string>({
  label,
  hint,
  values,
  options,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  values: readonly T[];
  options: { value: T; label: string }[];
  onChange: (next: T[]) => void;
}) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <p className="text-xs font-medium text-neutral-700">{label}</p>
      {hint && <HintDetails>{hint}</HintDetails>}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const active = values.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange(active ? values.filter((v) => v !== o.value) : [...values, o.value])
              }
              className={`min-h-9 border px-3 text-xs transition focus-visible:ring-2 focus-visible:ring-brand-400 ${
                active
                  ? "border-brand-500 bg-brand-50 font-medium text-brand-700"
                  : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-400"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 等级档位编辑器：名称 + 门槛分，1–6 档（上限 = 徽章色板长度，色板类名不能进数据库） */
export function LevelEditor({
  levels,
  maxLevels,
  onChange,
}: {
  levels: { name: string; min: number }[];
  /** 上限（= 徽章色板长度）；达到上限后「添加」禁用并说明原因 */
  maxLevels: number;
  onChange: (next: { name: string; min: number }[]) => void;
}) {
  const setAt = (i: number, patch: Partial<{ name: string; min: number }>) =>
    onChange(levels.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  /** 交换两档（同时交换名称与门槛），用于把档位调成期望的从低到高顺序 */
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= levels.length) return;
    const next = [...levels];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  const sorted = [...levels].sort((a, b) => a.min - b.min);
  const disorder = levels.some((l, i) => l !== sorted[i]);

  return (
    <div className="px-4 py-4 sm:px-5">
      <ol className="space-y-2">
        {levels.map((l, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="flex h-8 w-6 shrink-0 items-center justify-center bg-neutral-100 text-[11px] tabular-nums text-neutral-500">
              {i + 1}
            </span>
            <input
              aria-label={`第 ${i + 1} 档名称`}
              value={l.name}
              maxLength={20}
              onChange={(e) => setAt(i, { name: e.target.value })}
              className={`${INPUT_SM} min-w-0 flex-1`}
            />
            <input
              aria-label={`第 ${i + 1} 档门槛分`}
              type="number"
              inputMode="numeric"
              step={1}
              min={0}
              value={l.min}
              onChange={(e) => setAt(i, { min: Math.max(0, Number(e.target.value) || 0) })}
              className={`${INPUT_SM} w-24 shrink-0 text-right tabular-nums`}
            />
            <span className="w-6 shrink-0 text-[11px] text-neutral-400">分</span>
            <span className="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                aria-label={`第 ${i + 1} 档上移`}
                disabled={i === 0}
                onClick={() => swap(i, i - 1)}
                variant="ghost" className="h-8 w-8 justify-center p-0 disabled:opacity-30"
              >
                <ArrowUp size={13} aria-hidden />
              </Button>
              <Button
                type="button"
                aria-label={`删除第 ${i + 1} 档`}
                disabled={levels.length <= 1}
                onClick={() => onChange(levels.filter((_, idx) => idx !== i))}
                variant="ghost" className="h-8 w-8 justify-center p-0 text-red-600 disabled:opacity-30"
              >
                <Trash2 size={13} aria-hidden />
              </Button>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="button"
          disabled={levels.length >= maxLevels}
          onClick={() => {
            const last = levels[levels.length - 1];
            onChange([...levels, { name: `新等级 ${levels.length + 1}`, min: (last?.min ?? 0) + 500 }]);
          }}
          variant="ghost" className="min-h-9"
        >
          <Plus size={13} aria-hidden /> 添加档位
        </Button>
        <span className="text-[11px] leading-4 text-neutral-400">
          最多 {maxLevels} 档（受等级徽章色板长度限制，色板类名写死在源码里，不能存进配置）。
          门槛无序也能用：判定时按门槛升序，最高已达标门槛即当前等级。
        </span>
      </div>

      {disorder && (
        <p className="mt-2 border border-amber-300 bg-amber-50/70 px-3 py-2 text-[11px] leading-4 text-amber-700">
          当前档位门槛不是从低到高排列。保存后仍会正常工作，但建议调整顺序，避免看配置时误读。
        </p>
      )}
    </div>
  );
}
