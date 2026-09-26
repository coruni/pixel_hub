import Link from "next/link";
import BlockShell from "@/components/home/BlockShell";
import { getCategories } from "@/lib/queries";
import { getPublishedCountByCategory } from "@/lib/home";
import { chipClass } from "@/lib/ui/cls";

// 单行可见的分类数：与 /browse 的分类 chip 流保持一致，超出部分收进「+N 更多」。
// 首页这块只是直达入口，不做数量可视化，也不占大块版面。
const CATS_VISIBLE = 8;

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

  const visible = list.slice(0, CATS_VISIBLE);
  const rest = list.slice(CATS_VISIBLE);

  const chip = (c: (typeof list)[number]) => {
    const n = counts.get(c.id) ?? 0;
    return (
      <Link key={c.id} href={`/browse?cat=${c.slug}`} className={chipClass(false)}>
        {c.name}
        {/* 数字只作辅助信息：视觉上跟在名字后，读屏读成「分类（N 个内容）」 */}
        <span className="sr-only">（{n} 个内容）</span>
        <span
          aria-hidden
          className={`ml-1.5 tabular-nums ${n === 0 ? "text-neutral-300" : "text-neutral-400"}`}
        >
          {n}
        </span>
      </Link>
    );
  };

  return (
    <BlockShell title={title}>
      <div className="flex flex-wrap items-center gap-1.5">
        {visible.map(chip)}
        {rest.length > 0 && (
          // 原生 details 折叠，不需要客户端 JS；展开后原地补足，不跳页
          <details className="group flex w-full flex-wrap items-center gap-1.5">
            <summary
              className={`${chipClass(false)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
            >
              <span className="group-open:hidden">+{rest.length} 更多</span>
              <span className="hidden group-open:inline">收起</span>
            </summary>
            <div className="flex w-full flex-wrap items-center gap-1.5">{rest.map(chip)}</div>
          </details>
        )}
      </div>
    </BlockShell>
  );
}
