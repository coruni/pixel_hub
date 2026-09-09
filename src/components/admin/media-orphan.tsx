"use client";

// 媒体库孤儿清理：跨行多选（Provider 持有选中态，表格行内的勾选框与工具条共享）。
// 服务端已过滤出本页孤儿 id，客户端只负责选中与提交；真正的可删判定在 action 内逐条重做。
import { createContext, useContext, useMemo, useState } from "react";
import { SquareCheckbox } from "@/components/admin/SquareCheckbox";
import { useAction } from "@/lib/hooks";
import { confirmDialog } from "@/components/ui/feedback";
import { BTN_DANGER_SM, BTN_GHOST_SM } from "@/lib/ui/cls";
import { bulkDeleteOrphanMediaAction } from "@/lib/actions/admin-media";
import { Button } from "@/components/ui/Button";

type Ctx = {
  ids: string[];
  selected: string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAll: () => void;
  clear: () => void;
};

const OrphanCtx = createContext<Ctx | null>(null);

export function MediaOrphanProvider({
  ids,
  children,
}: {
  ids: string[];
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const value = useMemo<Ctx>(
    () => ({
      ids,
      selected,
      has: (id) => selected.includes(id),
      toggle: (id) =>
        setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
      selectAll: () => setSelected(ids),
      clear: () => setSelected([]),
    }),
    [ids, selected],
  );
  return <OrphanCtx.Provider value={value}>{children}</OrphanCtx.Provider>;
}

export function MediaOrphanToolbar() {
  const ctx = useContext(OrphanCtx);
  const { run, pending } = useAction();
  if (!ctx || ctx.ids.length === 0) return null;
  const n = ctx.selected.length;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-none border border-brand-200 bg-surface px-3 py-2">
      <span className="text-xs text-neutral-500">
        本页孤儿 {ctx.ids.length} 项，已选 {n} 项
      </span>
      <Button
        type="button"
        disabled={pending || n === ctx.ids.length}
        onClick={ctx.selectAll}
        className={BTN_GHOST_SM}
      >
        全选本页
      </Button>
      <Button type="button" disabled={pending || n === 0} onClick={ctx.clear} className={BTN_GHOST_SM}>
        清空选择
      </Button>
      <Button
        type="button"
        disabled={pending || n === 0}
        onClick={async () => {
          const ok = await confirmDialog({
            title: "清理孤儿媒体",
            message: `确认清理选中的 ${n} 项孤儿媒体？文件将一并移除且不可恢复。`,
            confirmLabel: "清理",
            danger: true,
          });
          if (!ok) return;
          run(() => bulkDeleteOrphanMediaAction(ctx.selected), { refresh: true });
        }}
        className={BTN_DANGER_SM}
      >
        {pending ? "清理中…" : `清理选中（${n}）`}
      </Button>
    </div>
  );
}

export function MediaOrphanCheckbox({ id, fileName }: { id: string; fileName?: string | null }) {
  const ctx = useContext(OrphanCtx);
  if (!ctx) return null;
  return (
    <SquareCheckbox
      checked={ctx.has(id)}
      onChange={() => ctx.toggle(id)}
      ariaLabel={`选择孤儿媒体 ${fileName ?? id}`}
    />
  );
}
