import type { ReactNode } from "react";

/** 发布向导共享的样式常量与字段错误提示 */

export const wizInput =
  "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm outline-none transition placeholder:text-neutral-400 focus:border-brand-500";
export const wizLabel = "mb-1 block text-sm font-medium text-neutral-700";

export function fieldErr(msg?: string[]): ReactNode {
  return msg && msg.length > 0 ? <p className="mt-1 text-xs text-red-500">{msg[0]}</p> : null;
}

/** 分节标题：序号方块 + 文案（+ 可选尾部说明） */
export function SectionTitle({
  n,
  children,
  tail,
}: {
  n: number;
  children: ReactNode;
  tail?: ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
      <span className="grid h-6 w-6 place-items-center rounded-none border border-brand-600 bg-brand-500 text-[11px] text-white">
        {n}
      </span>
      {children}
      {tail}
    </h2>
  );
}

export type Uploaded = {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
  thumbUrl: string | null;
  bigUrl: string | null;
  origUrl: string | null;
  width?: number | null;
  height?: number | null;
};

export type Cat = { id: string; name: string };
