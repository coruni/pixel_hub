"use client";

import { useState, useTransition } from "react";
import MiniBadge from "@/components/ui/MiniBadge";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Plus, Trash2 } from "lucide-react";
import {
  DETAIL_ONLY_KINDS,
  SIDEBAR_KIND_META,
  SIDEBAR_WIDGET_KINDS,
  getAreaWidgets,
  widgetTitle,
  withAreaWidgets,
  type SidebarWidget,
  type Theme,
  type WidgetAreaKey,
} from "@/lib/site-config";
import {
  addSidebarWidgetAction,
  removeSidebarWidgetAction,
  reorderSidebarWidgetsAction,
  updateSidebarWidgetAction,
  updateSidebarFlagsAction,
} from "@/lib/actions/site";
import DetailTemplateCard from "./DetailTemplateCard";
import FlagsCard from "./FlagsCard";
import NavbarCard from "./NavbarCard";
import WidgetEditor from "./WidgetEditor";
import { AREA_TABS, KindIcon, type RunFn, type SiteCategories, type SiteTags } from "./shared";

export default function SiteLayoutManager({
  theme: initial,
  categories,
  tags,
}: {
  theme: Theme;
  categories: SiteCategories;
  tags: SiteTags;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState(initial);
  const [prev, setPrev] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeArea, setActiveArea] = useState<WidgetAreaKey>("home");
  const [pending, start] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // 服务端 refresh 后以最新 props 为准（渲染期派生 state，避免 effect 内 setState）
  if (prev !== initial) {
    setPrev(initial);
    setTheme(initial);
  }

  const run: RunFn = (fn) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) window.alert(r.error ?? "操作失败");
      else router.refresh();
    });

  const widgets = getAreaWidgets(theme, activeArea);
  // showOn 开关只作用于侧边栏区域（详情页正文槽位常开）
  const isSidebarArea =
    activeArea === "home" || activeArea === "archive" || activeArea === "detail";
  const areaOn = !isSidebarArea || theme.sidebar.showOn[activeArea];

  // 拖拽/上下按钮共用：本地先重排以即时反馈，再持久化顺序
  function persistOrder(next: SidebarWidget[]) {
    setTheme(withAreaWidgets(theme, activeArea, next));
    run(() => reorderSidebarWidgetsAction(activeArea, next.map((w) => w.id)));
  }

  function moveBy(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= widgets.length) return;
    const next = [...widgets];
    const [m] = next.splice(index, 1);
    next.splice(target, 0, m);
    persistOrder(next);
  }

  function onDrop(index: number) {
    const from = dragId ? widgets.findIndex((w) => w.id === dragId) : -1;
    setDragId(null);
    setOverId(null);
    if (from < 0 || from === index) return;
    const next = [...widgets];
    const [m] = next.splice(from, 1);
    next.splice(index, 0, m);
    persistOrder(next);
  }

  return (
    <div className="space-y-6">
      <NavbarCard
        items={theme.navbar.items}
        menu={theme.navbar.categoriesMenu}
        run={run}
        pending={pending}
      />

      <DetailTemplateCard theme={theme} run={run} />

      <FlagsCard theme={theme} pending={pending} run={run} />

      <section className="rounded-none border border-brand-200 bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">页面组件</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              按区域分别配置：侧边栏三类页面，以及归档页、详情页的各正文槽位；组件各自独立，可排序、开关、删除。
              首页板块流在本页上方「首页布局」区管理。
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-neutral-600 hover:text-neutral-900 hover:underline"
          >
            预览 →（首页）
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap gap-1 border-b border-neutral-200" role="tablist">
          {AREA_TABS.map((t) => {
            const on = activeArea === t.key;
            const n = getAreaWidgets(theme, t.key).length;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`widget-tab-${t.key}`}
                aria-selected={on}
                aria-controls="widget-panel"
                title={t.hint}
                onClick={() => {
                  setActiveArea(t.key);
                  setEditingId(null);
                }}
                className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                  on
                    ? "border-brand-500 font-medium text-brand-700"
                    : "border-transparent text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {t.label}
                <span
                  className={`ml-1.5 text-[10px] tabular-nums ${on ? "text-brand-500" : "text-neutral-400"}`}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id="widget-panel"
          aria-labelledby={`widget-tab-${activeArea}`}
          className="focus:outline-none"
        >
          {!areaOn && (
            <div className="mt-3 flex items-center justify-between rounded-none border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
              <span>该页侧边栏已整体关闭，以下组件不会在前台显示。</span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() => updateSidebarFlagsAction({ showOn: { [activeArea]: true } }))
                }
                className="rounded-none border border-amber-400 bg-amber-100 px-2.5 py-1 font-medium text-amber-800 transition hover:bg-amber-200 disabled:opacity-50"
              >
                开启该页侧边栏
              </button>
            </div>
          )}

          {widgets.length === 0 ? (
            <p className="mt-4 rounded-none border-2 border-dashed border-brand-300 bg-brand-50/40 px-4 py-8 text-center text-sm text-neutral-400">
              暂无组件，从下方添加一个。
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {widgets.map((w, index) => (
                <li key={w.id} className="rounded-none border border-brand-200">
                  <div
                    draggable
                    onDragStart={(e) => {
                      setDragId(w.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (overId !== w.id) setOverId(w.id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      onDrop(index);
                    }}
                    className={`flex items-center gap-3 px-3 py-2.5 transition ${
                      overId === w.id ? "ring-2 ring-neutral-900/20" : ""
                    }`}
                  >
                    <span
                      className="cursor-grab text-neutral-300 active:cursor-grabbing"
                      aria-hidden
                    >
                      <GripVertical size={16} />
                    </span>
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-none ${
                        w.enabled ? "bg-brand-500 text-white" : "bg-neutral-100 text-neutral-400"
                      }`}
                    >
                      <KindIcon kind={w.kind} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-neutral-800">
                          {widgetTitle(w)}
                        </span>
                        <MiniBadge strong>{SIDEBAR_KIND_META[w.kind].label}</MiniBadge>
                        {!w.enabled && (
                          <span className="rounded-none bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500">
                            已停用
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={pending || index === 0}
                        onClick={() => moveBy(index, -1)}
                        aria-label="上移"
                        className="rounded-none p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30"
                      >
                        <ChevronUp size={15} />
                      </button>
                      <button
                        type="button"
                        disabled={pending || index === widgets.length - 1}
                        onClick={() => moveBy(index, 1)}
                        aria-label="下移"
                        className="rounded-none p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30"
                      >
                        <ChevronDown size={15} />
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(() => updateSidebarWidgetAction({ id: w.id, enabled: !w.enabled }))
                        }
                        aria-label={w.enabled ? "停用组件" : "启用组件"}
                        className="rounded-none p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30"
                      >
                        {w.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setEditingId(editingId === w.id ? null : w.id)}
                        className={`rounded-none p-1.5 transition hover:bg-neutral-100 ${
                          editingId === w.id
                            ? "text-neutral-900"
                            : "text-neutral-400 hover:text-neutral-800"
                        }`}
                      >
                        <span className="text-xs font-medium">编辑</span>
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (!window.confirm(`删除组件「${SIDEBAR_KIND_META[w.kind].label}」？`))
                            return;
                          run(() => removeSidebarWidgetAction(w.id));
                        }}
                        aria-label="删除组件"
                        className="rounded-none p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {editingId === w.id && (
                    <div className="border-t border-neutral-100 px-3 py-3">
                      <WidgetEditor
                        widget={w}
                        categories={categories}
                        tags={tags}
                        onDone={() => setEditingId(null)}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 rounded-none border-2 border-dashed border-brand-300 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
              添加组件
            </p>
            <div className="flex flex-wrap gap-2">
              {SIDEBAR_WIDGET_KINDS.map((kind) => {
                // 详情页专用组件在非详情区域置灰（配了也不会渲染）
                const detailOnly = (DETAIL_ONLY_KINDS as string[]).includes(kind);
                const detailArea =
                  activeArea === "detail" ||
                  activeArea === "detailTop" ||
                  activeArea === "detailMiddle" ||
                  activeArea === "detailBottom";
                const disabled = pending || (detailOnly && !detailArea);
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={disabled}
                    title={
                      detailOnly && !detailArea
                        ? "仅详情页（侧栏或正文槽位）可用"
                        : SIDEBAR_KIND_META[kind].desc
                    }
                    onClick={() => run(() => addSidebarWidgetAction(kind, activeArea))}
                    className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-400 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus size={12} />
                    {SIDEBAR_KIND_META[kind].label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
