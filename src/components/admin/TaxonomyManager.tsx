"use client";

import { Fragment, useState } from "react";
import { CornerDownRight, GitMerge, Plus, Save, Search, Trash2 } from "lucide-react";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import {
  TABLE,
  TABLE_WRAP,
  THEAD_ROW,
  TH,
  TH_RIGHT,
  TD,
  TD_RIGHT,
  TD_CHECK,
  TH_CHECK,
  TROW,
  EmptyRow,
} from "@/components/admin/DataTable";
import {
  createCategoryAction,
  deleteCategoryAction,
  deleteTagAction,
  renameTagAction,
  updateCategoryAction,
} from "@/lib/actions/taxonomy";
import { useAction } from "@/lib/hooks";
import { confirmDialog, toast } from "@/components/ui/feedback";
import {
  BTN_DANGER_SM,
  BTN_GHOST_SM,
  BTN_PRIMARY_SM,
  INPUT_SM,
  SELECT_SM,
} from "@/lib/ui/cls";
import { Button } from "@/components/ui/Button";

const SEARCH_SM =
  "rounded-none border border-brand-200 bg-surface px-3 py-1.5 text-sm outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-400";

// ---------- 分类管理（数据表格） ----------

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  sort: number;
  resourceCount: number;
  childCount: number;
  parentId: string | null;
};

export function CategoryManager({ rows }: { rows: CategoryRow[] }) {
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const [names, setNames] = useState<Record<string, string>>({});
  const [slugs, setSlugs] = useState<Record<string, string>>({});
  const [sorts, setSorts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [newChildFor, setNewChildFor] = useState<string | null>(null);
  const [childName, setChildName] = useState("");
  const [childSlug, setChildSlug] = useState("");

  const parentName = (pid: string | null) =>
    pid ? (rows.find((r) => r.id === pid)?.name ?? "—") : "";

  const rowDirty = (r: CategoryRow) => {
    const n = names[r.id];
    const s = slugs[r.id];
    const o = sorts[r.id];
    return (
      (n !== undefined && n !== r.name) ||
      (s !== undefined && s !== r.slug) ||
      (o !== undefined && o !== "" && o !== String(r.sort))
    );
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const save = (r: CategoryRow) => {
    const n = names[r.id];
    const s = slugs[r.id];
    const o = sorts[r.id];
    const nameDirty = n !== undefined && n !== r.name;
    const slugDirty = s !== undefined && s !== r.slug;
    const sortDirty = o !== undefined && o !== "" && o !== String(r.sort);
    if (!nameDirty && !slugDirty && !sortDirty) return;
    run(async () => {
      const res = await updateCategoryAction({
        id: r.id,
        ...(nameDirty ? { name: n } : {}),
        ...(slugDirty ? { slug: s ?? "" } : {}),
        ...(sortDirty ? { sort: Number.parseInt(o ?? "0", 10) || 0 } : {}),
      });
      if (res.ok) {
        setNames((p) => {
          const x = { ...p };
          delete x[r.id];
          return x;
        });
        setSlugs((p) => {
          const x = { ...p };
          delete x[r.id];
          return x;
        });
        setSorts((p) => {
          const x = { ...p };
          delete x[r.id];
          return x;
        });
      }
      return res;
    });
  };

  const createChild = (parentId: string) => {
    run(async () => {
      const res = await createCategoryAction({ name: childName, slug: childSlug, parentId });
      if (res.ok) {
        setNewChildFor(null);
        setChildName("");
        setChildSlug("");
      }
      return res;
    });
  };

  const batchDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirmDialog({
      title: "删除分类",
      message: `删除选中的 ${ids.length} 个分类？含内容的分类会被拒绝。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    run(async () => {
      for (const id of ids) {
        const res = await deleteCategoryAction({ id });
        if (!res.ok) toast(res.error ?? "删除失败");
      }
      setSelected(new Set());
      return { ok: true };
    });
  };

  return (
    <div className="space-y-4">
      {/* 新建顶级分类 */}
     <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="分类名称"
            className={`${INPUT_SM} w-44`}
            aria-label="新建分类名称"
          />
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="slug（留空按名称生成）"
            className={`${INPUT_SM} w-56`}
            aria-label="新建分类 slug"
          />
          <Button
            type="button"
            disabled={pending || !name.trim()}
            onClick={() =>
              run(async () => {
                const res = await createCategoryAction({ name, slug });
                if (res.ok) {
                  setName("");
                  setSlug("");
                }
                return res;
              })
            }
            className={BTN_PRIMARY_SM}
          >
            {pending ? "创建中…" : (<><Plus size={13} /> 新建分类</>)}
          </Button>
        </div>

      {/* 分类表格 */}
      <div className={TABLE_WRAP}>
        <table className={`${TABLE} min-w-[860px]`}>
          <thead>
            <tr className={THEAD_ROW}>
              <th className={TH_CHECK}>
                <SquareCheckbox checked={allSelected} onChange={toggleAll} ariaLabel="全选分类" />
              </th>
              <th className={TH}>名称</th>
              <th className={TH}>slug</th>
              <th className={`${TH} w-20`}>排序</th>
              <th className={TH}>层级</th>
              <th className={`${TH} w-20`}>内容</th>
              <th className={TH_RIGHT}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isChild = !!r.parentId;
              const dirty = rowDirty(r);
              return (
                <Fragment key={r.id}>
                  <tr className={TROW}>
                    <td className={TD_CHECK}>
                      <SquareCheckbox
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        ariaLabel={`选择分类 ${r.name}`}
                      />
                    </td>
                    <td className={TD}>
                      <input
                        value={names[r.id] ?? r.name}
                        onChange={(e) => setNames((p) => ({ ...p, [r.id]: e.target.value }))}
                        className={`${INPUT_SM} w-40`}
                        aria-label="分类名称"
                      />
                    </td>
                    <td className={TD}>
                      <input
                        value={slugs[r.id] ?? r.slug}
                        onChange={(e) => setSlugs((p) => ({ ...p, [r.id]: e.target.value }))}
                        className={`${INPUT_SM} w-44`}
                        aria-label="分类 slug"
                      />
                    </td>
                    <td className={TD}>
                      <input
                        type="number"
                        value={sorts[r.id] ?? r.sort}
                        onChange={(e) => setSorts((p) => ({ ...p, [r.id]: e.target.value }))}
                        className={`${INPUT_SM} w-16`}
                        aria-label="排序权重"
                      />
                    </td>
                    <td className={TD}>
                      {isChild ? (
                        <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                          <CornerDownRight size={13} className="text-neutral-400" aria-hidden />
                          {parentName(r.parentId)}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-500">顶级</span>
                      )}
                    </td>
                    <td className={TD}>
                      <span className="text-xs text-neutral-500">{r.resourceCount}</span>
                    </td>
                    <td className={TD_RIGHT}>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          disabled={pending || !dirty}
                          onClick={() => save(r)}
                          className={BTN_GHOST_SM}
                        >
                          {pending ? "保存中…" : (<><Save size={12} /> 保存</>)}
                        </Button>
                        {!isChild && (
                          <Button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              setNewChildFor(newChildFor === r.id ? null : r.id);
                              setChildName("");
                              setChildSlug("");
                            }}
                            className={BTN_GHOST_SM}
                          >
                            <Plus size={12} /> 子分类
                          </Button>
                        )}
                        <Button
                          type="button"
                          disabled={pending}
                          onClick={async () => {
                            const tip =
                              r.resourceCount > 0 ? `（含 ${r.resourceCount} 个内容）` : "";
                            const childTip =
                              !isChild && r.childCount > 0
                                ? `，且下有 ${r.childCount} 个子分类`
                                : "";
                            const ok = await confirmDialog({
                              title: "删除分类",
                              message: `删除分类「${r.name}」${tip}${childTip}？`,
                              confirmLabel: "删除",
                              danger: true,
                            });
                            if (!ok) return;
                            run(() => deleteCategoryAction({ id: r.id }));
                          }}
                          className={BTN_DANGER_SM}
                        >
                          <Trash2 size={12} /> {pending ? "删除中…" : "删除"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {!isChild && newChildFor === r.id && (
                    <tr className="border-b border-neutral-100 bg-brand-50/40">
                      <td className={TD} />
                      <td className={TD} colSpan={2}>
                        <input
                          value={childName}
                          onChange={(e) => setChildName(e.target.value)}
                          placeholder="子分类名称"
                          className={`${INPUT_SM} w-40`}
                          aria-label="子分类名称"
                        />
                      </td>
                      <td className={TD} colSpan={3}>
                        <input
                          value={childSlug}
                          onChange={(e) => setChildSlug(e.target.value)}
                          placeholder="slug（留空自动）"
                          className={`${INPUT_SM} w-56`}
                          aria-label="子分类 slug"
                        />
                      </td>
                      <td className={TD_RIGHT}>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            disabled={pending || !childName.trim()}
                            onClick={() => createChild(r.id)}
                            className={BTN_PRIMARY_SM}
                          >
                            {pending ? "创建中…" : (<><Plus size={12} /> 创建</>)}
                          </Button>
                          <Button
                            type="button"
                            disabled={pending}
                            onClick={() => setNewChildFor(null)}
                            className={BTN_GHOST_SM}
                          >
                            取消
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && <EmptyRow colSpan={7}>还没有分类</EmptyRow>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end">
        <Button
          type="button"
          disabled={pending || selected.size === 0}
          onClick={batchDelete}
          className={BTN_DANGER_SM}
        >
          {pending ? "删除中…" : (<><Trash2 size={12} /> 批量删除{selected.size > 0 ? `（${selected.size}）` : ""}</>)}
        </Button>
      </div>
    </div>
  );
}

// ---------- 标签管理（数据表格） ----------

export type TagRow = { id: string; name: string; slug: string; count: number };

export function TagManager({
  rows,
  q = "",
  pageSize = 30,
}: {
  rows: TagRow[];
  q?: string;
  pageSize?: number;
}) {
  const { run, pending } = useAction();
  const [names, setNames] = useState<Record<string, string>>({});
  const [slugs, setSlugs] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = rows.length > 0 && rows.every((t) => selected.has(t.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((t) => t.id)));

  const merge = async (t: TagRow) => {
    const targetId = mergeTarget[t.id];
    if (!targetId) return;
    const target = rows.find((r) => r.id === targetId);
    if (!target || target.id === t.id) return;
    const ok = await confirmDialog({
      title: "合并标签",
      message: `将标签「${t.name}」合并到「${target.name}」？关联内容会并入目标。`,
      confirmLabel: "合并",
    });
    if (!ok) return;
    run(() => renameTagAction({ id: t.id, name: target.name }));
  };

  const batchDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirmDialog({
      title: "删除标签",
      message: `删除选中的 ${ids.length} 个标签？关联内容将移除该标签。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    run(async () => {
      for (const id of ids) {
        const res = await deleteTagAction({ id });
        if (!res.ok) toast(res.error ?? "删除失败");
      }
      setSelected(new Set());
      return { ok: true };
    });
  };

  return (
    <div className="space-y-4">
      {/* 工具条：搜索（服务端 GET）+ 批量删除 */}
      <div className="flex flex-wrap items-center gap-2">
        <form method="get" action="/admin/tags" className="flex flex-1 items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
              aria-hidden
            />
            <input
              name="q"
              defaultValue={q}
              placeholder="搜索标签…"
              className={`${SEARCH_SM} w-56 pl-8`}
              aria-label="搜索标签"
            />
          </div>
          <Button type="submit" className={BTN_GHOST_SM}>
            搜索
          </Button>
          <input type="hidden" name="size" value={pageSize} />
        </form>
        <Button
          type="button"
          disabled={pending || selected.size === 0}
          onClick={batchDelete}
          className={BTN_DANGER_SM}
        >
          {pending ? "删除中…" : (<><Trash2 size={12} /> 批量删除{selected.size > 0 ? `（${selected.size}）` : ""}</>)}
        </Button>
      </div>

      {/* 标签表格 */}
      <div className={TABLE_WRAP}>
        <table className={`${TABLE} min-w-[760px]`}>
          <thead>
            <tr className={THEAD_ROW}>
              <th className={TH_CHECK}>
                <SquareCheckbox checked={allSelected} onChange={toggleAll} ariaLabel="全选标签" />
              </th>
              <th className={TH}>名称</th>
              <th className={TH}>slug</th>
              <th className={`${TH} w-20`}>内容</th>
              <th className={TH}>合并到</th>
              <th className={TH_RIGHT}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const edit = names[t.id];
              const editSlug = slugs[t.id];
              const dirty =
                (edit !== undefined && edit !== t.name) ||
                (editSlug !== undefined && editSlug !== t.slug);
              const targets = rows.filter((r) => r.id !== t.id);
              const target = mergeTarget[t.id];
              return (
                <tr key={t.id} className={TROW}>
                  <td className={TD_CHECK}>
                    <SquareCheckbox
                      checked={selected.has(t.id)}
                      onChange={() => toggle(t.id)}
                      ariaLabel={`选择标签 ${t.name}`}
                    />
                  </td>
                  <td className={TD}>
                    <input
                      value={edit ?? t.name}
                      onChange={(e) => setNames((p) => ({ ...p, [t.id]: e.target.value }))}
                      className={`${INPUT_SM} w-40`}
                      aria-label="标签名称"
                    />
                  </td>
                  <td className={TD}>
                    <input
                      value={editSlug ?? t.slug}
                      onChange={(e) => setSlugs((p) => ({ ...p, [t.id]: e.target.value }))}
                      className={`${INPUT_SM} w-44`}
                      aria-label="标签 slug"
                    />
                  </td>
                  <td className={TD}>
                    <span className="text-xs text-neutral-500">{t.count}</span>
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-1">
                      <GitMerge size={13} className="text-neutral-400" aria-hidden />
                      <select
                        value={target ?? ""}
                        onChange={(e) =>
                          setMergeTarget((p) => ({ ...p, [t.id]: e.target.value }))
                        }
                        className={SELECT_SM}
                        aria-label="合并到目标标签"
                      >
                        <option value="">选择…</option>
                        {targets.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}（{o.count}）
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className={TD_RIGHT}>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        disabled={pending || !target}
                        onClick={() => merge(t)}
                        className={BTN_GHOST_SM}
                      >
                        {pending ? "合并中…" : (<><GitMerge size={13} /> 合并</>)}
                      </Button>
                      <Button
                        type="button"
                        disabled={pending || !dirty}
                        onClick={() =>
                          run(async () => {
                            const slugDirty = editSlug !== undefined && editSlug !== t.slug;
                            const res = await renameTagAction({
                              id: t.id,
                              ...(edit !== undefined ? { name: edit } : {}),
                              ...(slugDirty ? { slug: editSlug } : {}),
                            });
                            if (res.ok) {
                              setNames((p) => {
                                const x = { ...p };
                                delete x[t.id];
                                return x;
                              });
                              setSlugs((p) => {
                                const x = { ...p };
                                delete x[t.id];
                                return x;
                              });
                            }
                            return res;
                          })
                        }
                        className={BTN_GHOST_SM}
                      >
                        {pending ? "保存中…" : (<><Save size={12} /> 保存</>)}
                      </Button>
                      <Button
                        type="button"
                        disabled={pending}
                        onClick={async () => {
                          const ok = await confirmDialog({
                            title: "删除标签",
                            message: `删除标签「${t.name}」？(${t.count} 个内容移除该标签)`,
                            confirmLabel: "删除",
                            danger: true,
                          });
                          if (!ok) return;
                          run(() => deleteTagAction({ id: t.id }));
                        }}
                        className={BTN_DANGER_SM}
                      >
                        {pending ? "删除中…" : (<><Trash2 size={12} /> 删除</>)}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <EmptyRow colSpan={6}>没有匹配的标签</EmptyRow>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
