"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Menu, Plus, Trash2 } from "lucide-react";
import { NAV_ICON_MAP } from "@/lib/nav-icons";
import { INPUT_SM } from "@/lib/ui/cls";
import { SquareCheckbox } from "../admin/SquareCheckbox";
import {
  NAV_ICONS,
  NAV_VISIBILITY_KEYS,
  NAV_VISIBILITY_LABELS,
  type CategoriesMenuCfg,
  type NavItem,
} from "@/lib/site-config";
import { updateCategoriesMenuAction, updateNavbarAction } from "@/lib/actions/site";
import type { RunFn } from "./shared";

export default function NavbarCard({
  items: initialItems,
  menu: initialMenu,
  run,
  pending,
}: {
  items: NavItem[];
  menu: CategoriesMenuCfg;
  run: RunFn;
  pending: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [prev, setPrev] = useState(initialItems);
  const [menu, setMenu] = useState(initialMenu);
  const [prevMenu, setPrevMenu] = useState(initialMenu);
  // 服务端 refresh 后同步（渲染期派生 state）
  if (prev !== initialItems) {
    setPrev(initialItems);
    setItems(initialItems);
  }
  if (prevMenu !== initialMenu) {
    setPrevMenu(initialMenu);
    setMenu(initialMenu);
  }
  const dirty =
    JSON.stringify(items) !== JSON.stringify(initialItems) ||
    JSON.stringify(menu) !== JSON.stringify(initialMenu);
  const setAt = (i: number, patch: Partial<NavItem>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: number) =>
    setItems((arr) => {
      const t = i + d;
      if (t < 0 || t >= arr.length) return arr;
      const next = [...arr];
      const [m] = next.splice(i, 1);
      next.splice(t, 0, m);
      return next;
    });
  const add = () =>
    setItems((arr) => [
      ...arr,
      {
        id: `nav-${Math.random().toString(36).slice(2, 8)}`,
        label: "新链接",
        href: "/",
        icon: null,
        newTab: false,
        showTo: "all",
        enabled: true,
      },
    ]);

  const iconBtn =
    "grid h-7 w-7 shrink-0 place-items-center rounded-none text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30";

  return (
    <section className="rounded-none border border-brand-200 bg-surface p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Menu size={16} className="text-neutral-400" aria-hidden />
          <h2 className="text-base font-semibold text-neutral-900">顶部导航栏</h2>
          {dirty && (
            <span className="rounded-none bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
              有未保存修改
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r1 = await updateNavbarAction(items);
              if (!r1.ok) return r1;
              return updateCategoriesMenuAction(menu);
            })
          }
          className="rounded-none border border-brand-600 bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {pending ? "保存中…" : dirty ? "保存导航" : "已保存"}
        </button>
      </div>

      <div className="mt-4 space-y-1.5">
        {items.map((it, i) => {
          const Icon = it.icon ? (NAV_ICON_MAP[it.icon] ?? null) : null;
          return (
            <div
              key={it.id}
              className="flex flex-wrap items-center gap-1.5 rounded-none border border-brand-200 px-2 py-1.5"
            >
              <button
                type="button"
                disabled={pending || i === 0}
                onClick={() => move(i, -1)}
                aria-label="上移"
                className={iconBtn}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                disabled={pending || i === items.length - 1}
                onClick={() => move(i, 1)}
                aria-label="下移"
                className={iconBtn}
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setAt(i, { enabled: !it.enabled })}
                aria-label={it.enabled ? "停用" : "启用"}
                className={iconBtn}
              >
                {it.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
                aria-label="删除"
                className={`${iconBtn} hover:bg-red-50 hover:text-red-500`}
              >
                <Trash2 size={14} />
              </button>

              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-none ${it.enabled ? "bg-brand-500 text-white" : "bg-neutral-100 text-neutral-400"}`}
              >
                {Icon ? <Icon size={14} /> : <span className="text-[10px]">·</span>}
              </span>

              <input
                value={it.label}
                onChange={(e) => setAt(i, { label: e.target.value.slice(0, 24) })}
                placeholder="名称"
                className={`w-24 ${INPUT_SM}`}
                aria-label="名称"
              />
              <input
                value={it.href}
                onChange={(e) => setAt(i, { href: e.target.value.slice(0, 300) })}
                placeholder="/路径 或 https://外链"
                className={`min-w-40 flex-1 ${INPUT_SM}`}
                aria-label="地址"
              />
              <select
                value={it.icon ?? ""}
                onChange={(e) => setAt(i, { icon: e.target.value || null })}
                className={`w-28 ${INPUT_SM}`}
                aria-label="图标"
              >
                <option value="">无图标</option>
                {NAV_ICONS.map((ic) => (
                  <option key={ic} value={ic}>
                    {ic}
                  </option>
                ))}
              </select>
              <select
                value={it.showTo}
                onChange={(e) => setAt(i, { showTo: e.target.value as NavItem["showTo"] })}
                className={`w-28 ${INPUT_SM}`}
                aria-label="可见性"
              >
                {NAV_VISIBILITY_KEYS.map((v) => (
                  <option key={v} value={v}>
                    {NAV_VISIBILITY_LABELS[v]}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={add}
          className="inline-flex items-center gap-1 rounded-none border border-brand-200 px-3 py-1.5 text-xs text-neutral-600 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
        >
          <Plus size={12} /> 添加导航项
        </button>
        <span className="self-center text-[11px] text-neutral-400">外链需以 http(s):// 开头</span>
      </div>

      <div className="mt-4 rounded-none border border-brand-200 bg-brand-50/40 p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800">
            <SquareCheckbox checked={menu.enabled} onChange={(next) => setMenu({ ...menu, enabled: next })} ariaLabel="启用分类菜单" />
            启用「分类」下拉菜单
          </label>
          <input
            value={menu.label}
            onChange={(e) => setMenu({ ...menu, label: e.target.value })}
            placeholder="菜单文字"
            className={`${INPUT_SM} w-28`}
            aria-label="菜单文字"
          />
          <span className="text-[11px] text-neutral-400">导航链接后显示分类直达下拉</span>
        </div>
      </div>
    </section>
  );
}
