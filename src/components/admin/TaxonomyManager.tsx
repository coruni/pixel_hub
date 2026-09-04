"use client";

import { useMemo, useState } from "react";
import MiniBadge from "@/components/ui/MiniBadge";
import { Plus, Save, Search, Trash2 } from "lucide-react";
import {
  createCategoryAction,
  deleteCategoryAction,
  deleteTagAction,
  renameTagAction,
  updateCategoryAction,
} from "@/lib/actions/taxonomy";
import { useAction } from "@/lib/hooks";
import { BTN_DANGER_SM, BTN_GHOST_SM, BTN_PRIMARY_SM, INPUT_SM } from "@/lib/ui/cls";

// ---------- 分类管理 ----------

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  sort: number;
  resourceCount: number;
};

export function CategoryManager({ rows }: { rows: CategoryRow[] }) {
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});

  const setEdit = (id: string, v: string) => setEdits((prev) => ({ ...prev, [id]: v }));

  return (
    <div className="space-y-6">
      {/* 新建 */}
      <section className="rounded-none border border-brand-200 bg-surface p-4">
        <h3 className="text-sm font-semibold text-neutral-900">新建分类</h3>
        <p className="mt-1 text-xs text-neutral-400">
          分类对所有类型通用（图片/游戏共用一套分类）。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名称（如：像素艺术）"
            className={`${INPUT_SM} w-44`}
          />
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="slug（如 pixel-art，留空按名称生成）"
            className={`${INPUT_SM} w-64`}
          />
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={() =>
              run(async () => {
                const r = await createCategoryAction({ name, slug });
                if (r.ok) {
                  setName("");
                  setSlug("");
                }
                return r;
              })
            }
            className={BTN_PRIMARY_SM}
          >
            <Plus size={13} /> 新建
          </button>
        </div>
      </section>

      {/* 列表 */}
      <section className="rounded-none border border-brand-200 bg-surface p-4">
        <h3 className="text-sm font-semibold text-neutral-900">
          分类
          <span className="ml-1.5 text-xs font-normal text-neutral-400">{rows.length} 个</span>
        </h3>
        <ul className="mt-2 divide-y divide-neutral-100">
          {rows.map((r) => {
            const edit = edits[r.id];
            const dirty = edit !== undefined && edit !== r.name;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <input
                  value={edit ?? r.name}
                  onChange={(e) => setEdit(r.id, e.target.value)}
                  className={`${INPUT_SM} w-44`}
                />
                <span className="text-xs text-neutral-400">/{r.slug}</span>
                <MiniBadge>{r.resourceCount} 内容</MiniBadge>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending || !dirty}
                    onClick={() =>
                      run(async () => {
                        const r2 = await updateCategoryAction({ id: r.id, name: edit });
                        if (r2.ok)
                          setEdits((prev) => {
                            const next = { ...prev };
                            delete next[r.id];
                            return next;
                          });
                        return r2;
                      })
                    }
                    className={BTN_GHOST_SM}
                  >
                    <Save size={12} /> 保存
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(`删除分类「${r.name}」？`)) return;
                      run(() => deleteCategoryAction({ id: r.id }));
                    }}
                    className={BTN_DANGER_SM}
                  >
                    <Trash2 size={12} /> 删除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

// ---------- 标签管理 ----------

export type TagRow = { id: string; name: string; slug: string; count: number };

export function TagManager({ rows }: { rows: TagRow[] }) {
  const { run, pending } = useAction();
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const filtered = kw
      ? rows.filter((t) => t.name.toLowerCase().includes(kw) || t.slug.includes(kw))
      : rows;
    return [...filtered].sort((a, b) => b.count - a.count);
  }, [rows, q]);

  return (
    <div className="rounded-none border border-brand-200 bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-neutral-900">
          标签
          <span className="ml-1.5 text-xs font-normal text-neutral-400">
            {rows.length} 个 · 按热度排序
          </span>
        </h3>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标签…"
            className={`${INPUT_SM} w-56 pl-8`}
          />
        </div>
      </div>

      <ul className="mt-3 divide-y divide-neutral-100">
        {list.map((t) => {
          const edit = edits[t.id];
          const dirty = edit !== undefined && edit !== t.name;
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <input
                value={edit ?? t.name}
                onChange={(e) => setEdits((prev) => ({ ...prev, [t.id]: e.target.value }))}
                className={`${INPUT_SM} w-44`}
              />
              <span className="text-xs text-neutral-400">/{t.slug}</span>
              <MiniBadge>{t.count} 内容</MiniBadge>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  disabled={pending || !dirty}
                  onClick={() =>
                    run(async () => {
                      const r = await renameTagAction({ id: t.id, name: edit });
                      if (r.ok)
                        setEdits((prev) => {
                          const next = { ...prev };
                          delete next[t.id];
                          return next;
                        });
                      return r;
                    })
                  }
                  className={BTN_GHOST_SM}
                >
                  <Save size={12} /> 保存
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`删除标签「${t.name}」？(${t.count} 个内容将移除该标签)`))
                      return;
                    run(() => deleteTagAction({ id: t.id }));
                  }}
                  className={BTN_DANGER_SM}
                >
                  <Trash2 size={12} /> 删除
                </button>
              </div>
            </li>
          );
        })}
        {list.length === 0 && (
          <li className="py-8 text-center text-sm text-neutral-400">没有匹配的标签</li>
        )}
      </ul>
      <p className="mt-3 text-xs text-neutral-400">
        重命名为已有标签时会自动合并（关联内容与计数并入目标标签）。
      </p>
    </div>
  );
}
