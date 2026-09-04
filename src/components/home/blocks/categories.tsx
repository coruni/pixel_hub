import Link from "next/link";
import BlockShell from "@/components/home/BlockShell";
import { ChevronRight } from "lucide-react";
import { getCategories } from "@/lib/queries";
import { getPublishedCountByCategory } from "@/lib/home";

// 像素分段条（RPG 数值条）：把数量归一到 10 格方块
const SEGS = 10;

export default async function CategoriesBlock({
  title,
  cfg,
}: {
  title: string | null;
  cfg: { slugs: string[] };
}) {
  const categories = await getCategories();
  const counts = await getPublishedCountByCategory();

  let list = categories;
  if (cfg.slugs.length > 0) {
    const wanted = new Set(cfg.slugs);
    list = list.filter((c) => wanted.has(c.slug));
  }
  if (list.length === 0) return null;

  const max = Math.max(1, ...list.map((c) => counts.get(c.id) ?? 0));

  return (
<BlockShell title={title}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((c) => {
            const n = counts.get(c.id) ?? 0;
            // 有内容至少亮 1 格，满额亮满
            const filled = n === 0 ? 0 : Math.max(1, Math.round((n / max) * SEGS));
            return (
              <Link
                key={c.id}
                href={`/browse?cat=${c.slug}`}
                className="group relative rounded-none border border-brand-200 bg-surface p-3 transition hover:border-brand-500"
              >
                {/* 名称行：方块图标 + 名称 + hover 进入箭头 */}
                <span className="flex items-center gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-none border border-brand-600 bg-brand-500 text-xs text-white transition group-hover:bg-brand-600">
                    {(c.name ?? "?").slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800">
                    {c.name}
                  </span>
                  <ChevronRight
                    size={14}
                    aria-hidden
                    className="shrink-0 text-brand-500 opacity-0 transition group-hover:opacity-100"
                  />
                </span>

                {/* 像素分段数量条 */}
                <span className="mt-2.5 flex gap-[3px]" aria-hidden>
                  {Array.from({ length: SEGS }, (_, i) => (
                    <span
                      key={i}
                      className={`h-2 flex-1 transition-colors ${
                        i < filled ? "bg-brand-500 group-hover:bg-brand-400" : "bg-brand-100"
                      }`}
                    />
                  ))}
                </span>

                {/* 数值行 */}
                <span className="mt-1.5 flex items-baseline justify-between">
                  <span className="text-[10px] text-neutral-400">内容数量</span>
                  {n === 0 ? (
                    <span className="text-[11px] text-neutral-300">暂无内容</span>
                  ) : (
                    <span className="text-sm font-medium tabular-nums text-brand-600">
                      {n}
                      <span className="ml-0.5 text-[10px] font-normal text-neutral-400">个</span>
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
    </BlockShell>
  );
}
