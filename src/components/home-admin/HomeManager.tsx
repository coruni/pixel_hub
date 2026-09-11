"use client";

import { useState, useTransition } from "react";
import MiniBadge from "@/components/ui/MiniBadge";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BadgeCheck,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  List as ListRows,
  Plus,
  RectangleHorizontal,
  Rss,
  Sparkles,
  Tags as TagsIcon,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import {
  HOME_KIND_META,
  HOME_SECTION_KINDS,
  homeKindLabel,
  type HomeSectionKind,
} from "@/lib/home-config";
import {
  addHomeSectionAction,
  removeHomeSectionAction,
  reorderHomeSectionsAction,
  updateHomeSectionAction,
} from "@/lib/actions/home";
import { confirmDialog, toast } from "@/components/ui/feedback";
import SectionEditor, {
  type HeroPickMeta,
  type ManagerRow,
  type PickOptionCat,
  type PickOptionTag,
} from "./SectionEditor";
import { Button } from "@/components/ui/Button";

function KindIcon({ kind, size = 15 }: { kind: HomeSectionKind; size?: number }) {
  const map: Record<HomeSectionKind, typeof Sparkles> = {
    hero: Sparkles,
    categories: LayoutGrid,
    list: ListRows,
    featured: BadgeCheck,
    feed: Rss,
    stats: BarChart3,
    creators: Users,
    tags: TagsIcon,
    ad: RectangleHorizontal,
    recommend: Wand2,
  };
  const Icon = map[kind] ?? Sparkles;
  return <Icon size={size} aria-hidden />;
}

const dispLabel: Record<string, string> = { card: "卡片", list: "列表" };
const sortLabel: Record<string, string> = {
  latest: "最新",
  popular: "最热",
  downloads: "最多下载",
};
// 板块配置摘要用短标签（TYPE_LABEL 的 IMAGE 是全称「图片作品」，这里空间紧凑取「图片」）
const typeLabel: Record<string, string> = {
  ALL: "全部",
  IMAGE: "图片",
  GAME: "游戏",
  ARTICLE: "文章",
};
// 热门时间窗口摘要（all 不显示）
const periodLabel: Record<string, string> = { week: "近7天", month: "近30天" };

function cfgSummary(row: ManagerRow): string {
  const c = row.config as Record<string, unknown>;
  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  switch (row.kind) {
    case "hero": {
      const pl = periodLabel[String(c.period ?? "all")];
      if (n(c.featuredIds)) return `已挑选 ${n(c.featuredIds)} 个资源`;
      return pl ? `未挑选 · 自动展示${pl}最热` : "未挑选 · 自动展示近期最热";
    }
    case "categories":
      return n(c.slugs) ? `已挑选 ${n(c.slugs)} 个分类` : "展示全部分类";
    case "list": {
      const parts = [
        typeLabel[String(c.type ?? "ALL")] ?? "全部",
        sortLabel[String(c.sort ?? "latest")] ?? "最新",
        `${c.count ?? 12} 个`,
      ];
      if (n(c.categorySlugs)) parts.push(`${n(c.categorySlugs)} 个分类`);
      if (n(c.tagSlugs)) parts.push(`${n(c.tagSlugs)} 个标签`);
      parts.push(dispLabel[String(c.display ?? "card")] ?? "卡片");
      if (c.paged === true) parts.push("可翻页");
      // 时间窗口仅对热门类排序有意义
      const pl = periodLabel[String(c.period ?? "all")];
      if (pl && (c.sort === "popular" || c.sort === "downloads")) parts.push(pl);
      return parts.join(" · ");
    }
    case "featured": {
      const dl = dispLabel[String(c.display ?? "card")] ?? "卡片";
      if (n(c.featuredIds)) return `专题含 ${n(c.featuredIds)} 个资源（${dl}）`;
      const pl = periodLabel[String(c.period ?? "all")];
      return pl ? `未挑选 · 兜底${pl}热门（${dl}）` : `未挑选 · 兜底热门（${dl}）`;
    }
    case "feed":
      return c.showTags ? "全站浏览 + 顶部热门标签" : "全站浏览（纯净）";
    case "creators":
      return `按粉丝数展示 ${c.count ?? 6} 位创作者`;
    case "recommend": {
      const scope = c.scope === "all" ? "全站热门" : "个性化推荐";
      const cnt = Number(c.count ?? 12);
      const er = Number(c.explorationRatio ?? 0.3);
      const cats = n(c.categorySlugs);
      return `${scope} · 展示 ${cnt} 个${cats ? ` · ${cats} 个分类` : ""} · 探索 ${er.toFixed(2)}`;
    }
    case "tags":
      return n(c.slugs) ? `展示所选 ${n(c.slugs)} 个标签` : `展示 ${c.count ?? 12} 个热门标签`;
    case "ad": {
      const suffix = c.badge === false ? "（无角标）" : "";
      if (c.mode === "html")
        return (
          (String(c.html ?? "").trim() ? "HTML / 联盟广告代码" : "未配置 · 前台不显示") + suffix
        );
      return (
        (String(c.image ?? "").trim()
          ? `图片广告${String(c.link ?? "").trim() ? " + 跳转链接" : ""}`
          : "未配置 · 前台不显示") + suffix
      );
    }
    default:
      return HOME_KIND_META[row.kind].desc;
  }
}

export default function HomeManager({
  rows: initialRows,
  picksMap,
  categories,
  tags,
}: {
  rows: ManagerRow[];
  picksMap: Record<string, HeroPickMeta[]>;
  categories: PickOptionCat[];
  tags: PickOptionTag[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [prev, setPrev] = useState(initialRows);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // 服务端 refresh 后以最新 props 为准（增删/保存后同步列表）：渲染期派生 state，避免在 effect 里 setState
  if (prev !== initialRows) {
    setPrev(initialRows);
    setRows(initialRows);
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast(r.error ?? "操作失败");
      else router.refresh();
    });

  function persistOrder(next: ManagerRow[]) {
    setRows(next);
    start(async () => {
      await reorderHomeSectionsAction(next.map((r) => r.id));
      router.refresh();
    });
  }

  function moveBy(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [m] = next.splice(index, 1);
    next.splice(target, 0, m);
    persistOrder(next);
  }

  function onDrop(index: number) {
    const from = dragId ? rows.findIndex((r) => r.id === dragId) : -1;
    setDragId(null);
    setOverId(null);
    if (from < 0 || from === index) return;
    const next = [...rows];
    const [m] = next.splice(from, 1);
    next.splice(index, 0, m);
    persistOrder(next);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          拖拽或上下按钮调整板块顺序，改动实时生效。
        </p>
        <Link href="/" className="text-sm text-neutral-600 hover:text-neutral-900 hover:underline">
          预览首页 →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-none border border-brand-200 bg-surface px-5 py-10 text-center text-sm text-neutral-400">
          暂无板块，从下方添加一个开始搭建首页。
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li key={row.id} className="rounded-none border border-brand-200 bg-surface">
              <div
                draggable
                onDragStart={(e) => {
                  setDragId(row.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overId !== row.id) setOverId(row.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(index);
                }}
                className={`flex items-center gap-3 px-3 py-3 transition ${
                  overId === row.id ? "ring-2 ring-neutral-900/20" : ""
                }`}
              >
                <span className="cursor-grab text-neutral-300 active:cursor-grabbing" aria-hidden>
                  <GripVertical size={16} />
                </span>

                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-none ${
                    row.enabled ? "bg-brand-500 text-white" : "bg-neutral-100 text-neutral-400"
                  }`}
                >
                  <KindIcon kind={row.kind} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-neutral-800">
                      {row.title || (
                        <span className="text-neutral-400">
                          {HOME_KIND_META[row.kind].defaultTitle ?? "（未命名）"}
                        </span>
                      )}
                    </span>
                    <MiniBadge strong>{homeKindLabel(row.kind)}</MiniBadge>
                    {!row.enabled && (
                      <span className="rounded-none bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
                        已停用
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-neutral-400">{cfgSummary(row)}</p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    disabled={pending || index === 0}
                    onClick={() => moveBy(index, -1)}
                    aria-label="上移"
                    className="rounded-none p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30"
                  >
                    <ChevronUp size={15} />
                  </Button>
                  <Button
                    type="button"
                    disabled={pending || index === rows.length - 1}
                    onClick={() => moveBy(index, 1)}
                    aria-label="下移"
                    className="rounded-none p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30"
                  >
                    <ChevronDown size={15} />
                  </Button>
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => updateHomeSectionAction({ id: row.id, enabled: !row.enabled }))
                    }
                    className={`rounded-none p-1.5 transition ${
                      row.enabled
                        ? "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"
                        : "text-neutral-300 hover:text-neutral-600"
                    }`}
                    aria-label={row.enabled ? "停用板块" : "启用板块"}
                  >
                    {row.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
                  </Button>
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={() => setEditingId(editingId === row.id ? null : row.id)}
                    className={`rounded-none p-1.5 transition hover:bg-neutral-100 ${
                      editingId === row.id
                        ? "text-neutral-900"
                        : "text-neutral-400 hover:text-neutral-800"
                    }`}
                    aria-label="编辑板块"
                  >
                    <span className="text-xs font-medium">编辑</span>
                  </Button>
                  <Button
                    type="button"
                    disabled={pending}
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: "删除板块",
                        message: `确认删除板块「${homeKindLabel(row.kind)}」？`,
                        confirmLabel: "删除",
                        danger: true,
                      });
                      if (!ok) return;
                      run(() => removeHomeSectionAction(row.id));
                    }}
                    className="rounded-none p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-500"
                    aria-label="删除板块"
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>

              {editingId === row.id && (
                <div className="border-t border-neutral-100 px-3 py-3">
                  <SectionEditor
                    row={row}
                    picks={picksMap[row.id] ?? []}
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

      <div className="mt-6 rounded-none border-2 border-dashed border-brand-300 p-4">
        <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-neutral-400">
          添加板块
        </p>
        <div className="flex flex-wrap gap-2">
          {HOME_SECTION_KINDS.map((kind) => (
            <Button
              key={kind}
              type="button"
              disabled={pending}
              onClick={() => run(() => addHomeSectionAction(kind))}
              className="inline-flex items-center gap-1.5 rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-xs text-neutral-700 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
            >
              <Plus size={12} />
              {HOME_KIND_META[kind].label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">
          同一板块可重复添加（如两个不同分类入口）；首页按此顺序渲染，注意信息密度。
        </p>
      </div>
    </div>
  );
}
