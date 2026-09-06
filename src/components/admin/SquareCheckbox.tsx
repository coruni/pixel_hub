"use client";

// 后台统一勾选框：直角像素语言（rounded-none）+ 品牌主色，所有后台表格与表单的选择项复用。
// 既支持受控（checked + onChange），也支持非受控表单字段（name + defaultChecked），
// 后者可直接随 FormData 提交，无需额外状态。
import { useState } from "react";
import { Check } from "lucide-react";

type Props = {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (next: boolean) => void;
  name?: string;
  value?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

export function SquareCheckbox({
  checked,
  defaultChecked,
  onChange,
  name,
  value,
  disabled,
  ariaLabel,
  className = "",
}: Props) {
  const isControlled = checked !== undefined;
  const [internal, setInternal] = useState(!!defaultChecked);
  const isOn = isControlled ? checked : internal;
  return (
    <span className={`relative inline-flex h-4 w-4 shrink-0 ${className}`}>
      <input
        type="checkbox"
        name={name}
        value={value}
        disabled={disabled}
        checked={isControlled ? checked : undefined}
        defaultChecked={isControlled ? undefined : defaultChecked}
        onChange={(e) => {
          if (!isControlled) setInternal(e.target.checked);
          onChange?.(e.target.checked);
        }}
        aria-label={ariaLabel}
        className="peer h-4 w-4 cursor-pointer appearance-none rounded-none border border-brand-400 bg-surface transition hover:border-brand-500 checked:border-brand-500 checked:bg-brand-500 focus-visible:ring-2 focus-visible:ring-brand-400"
      />
      {isOn && (
        <Check
          size={12}
          strokeWidth={3}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white"
          aria-hidden
        />
      )}
    </span>
  );
}
