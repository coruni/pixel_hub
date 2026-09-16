"use client";

import type { ReactNode } from "react";
import { SquareCheckbox } from "../admin/SquareCheckbox";

export const wizInput =
  "w-full rounded-none border border-brand-200 bg-surface px-3.5 py-2.5 text-sm outline-none transition placeholder:text-neutral-400 focus:border-brand-500";
export const wizLabel = "mb-1 block text-sm font-medium text-neutral-700";

/**
 * 表单内分节编号：发布向导（/upload）与改稿页（/admin/content/[id]/edit）共用同一批分节组件，
 * 所以两边必须用同一份编号，从 1 起连号——否则一旦某边多/少一屏就会各自漂移。
 */
export const STEP = { BASIC: 1, TYPE: 2, MEDIA: 3, OPTIONS: 4 } as const;

/** 发布向导的「选择发布类型」是进入表单前的独立一屏，不参与表单内连号。 */
export const MODE_STEP = 1;

/**
 * 发布选项（可见性与互动）：发布向导与改稿页共用同一份定义与同一套勾选卡片。
 * name 即表单字段名，两处的服务端 action 读的是同一批字段，文案与顺序必须一致。
 */
export const PUBLISH_OPTIONS = [
  { name: "nsfw", label: "NSFW", hint: "未登录与搜索引擎不可见" },
  { name: "loginRequired", label: "下载需登录", hint: "游客看不到下载入口" },
  { name: "allowComments", label: "允许评论", hint: "关闭后详情页不再接收评论" },
] as const;

export type PublishOptionName = (typeof PUBLISH_OPTIONS)[number]["name"];

export function fieldErr(msg?: string[]): ReactNode {
  return msg && msg.length > 0 ? <p className="mt-1 text-xs text-red-500">{msg[0]}</p> : null;
}

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

/**
 * 发布选项卡片网格：标题单独一行，勾选项在下方两列网格里，不与 section 标题挤在同一行。
 * checkedOf 只决定初始勾选状态（非受控字段，随 FormData 提交）。
 */
export function PublishOptionGrid({
  checkedOf,
}: {
  checkedOf?: (name: PublishOptionName) => boolean | undefined;
}) {
  return (
    <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
      {PUBLISH_OPTIONS.map((o) => (
        <label
          key={o.name}
          className="flex items-start gap-2.5 rounded-none border border-brand-200 px-3 py-2.5"
        >
          <SquareCheckbox
            name={o.name}
            defaultChecked={checkedOf?.(o.name)}
            ariaLabel={o.label}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-sm text-neutral-800">{o.label}</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-neutral-400">{o.hint}</span>
          </span>
        </label>
      ))}
    </div>
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
