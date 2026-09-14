// 后台概览图表 —— 无交互的静态图形（条 / 堆叠条），纯展示、无 hooks、不引图表库；
// 需要 hover 查看数值的折线图是客户端组件，见 ./chart-line.tsx。
// 颜色一律走 Tailwind token class + currentColor，明暗主题自动跟随；
// 图形语义色统一用 500 阶（亮/暗底上均满足 3:1 非文本对比度），文字用 neutral 阶。

export type Tone = "brand" | "sky" | "emerald" | "amber" | "red" | "neutral";

export const TONE_BG: Record<Tone, string> = {
  brand: "bg-brand-500",
  sky: "bg-sky-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  neutral: "bg-neutral-400",
};

/**
 * 横向相对长度条：组内最大值归一为满格（不同量纲的指标不要放同一组）。
 * 0 值保留空轨道，正数最小给 4% 以保证可见。
 * hover 查看：悬停整行时在数值左侧浮出「占组内合计 x%」，并提亮色条；title 兜底给原生提示
 * （移动端无 hover，占比不是完成任务所必需的信息，故默认隐藏不构成信息缺失）。
 */
export function BarList({
  items,
}: {
  items: { label: string; value: number; text?: string; tone?: Tone }[];
}) {
  const max = Math.max(1, ...items.map((i) => (Number.isFinite(i.value) ? i.value : 0)));
  const total = items.reduce((s, i) => s + (Number.isFinite(i.value) ? i.value : 0), 0);
  return (
    <ul className="space-y-3">
      {items.map((it) => {
        const pct = it.value > 0 ? Math.max(4, Math.round((it.value / max) * 100)) : 0;
        const shown = it.text ?? it.value.toLocaleString();
        const share = total > 0 ? Math.round((it.value / total) * 1000) / 10 : 0;
        return (
          <li
            key={it.label}
            title={`${it.label} ${shown}（占组内合计 ${share}%）`}
            className="group text-xs"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-neutral-500">{it.label}</span>
              <span className="flex shrink-0 items-baseline gap-1.5">
                <span className="hidden tabular-nums text-[10px] text-neutral-400 group-hover:inline">
                  占组内合计 {share}%
                </span>
                <span className="font-medium tabular-nums text-neutral-900">{shown}</span>
              </span>
            </div>
            <div className="mt-1 h-2 w-full border border-neutral-200 bg-neutral-100">
              <div
                className={`h-full ${TONE_BG[it.tone ?? "brand"]} transition-[filter] group-hover:brightness-110`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 100% 堆叠条 + 图例：表现同一总量下的构成占比（各项互斥，不可重叠计数）。
 * hover 查看：色段与图例行都带 title（含数量与占比），悬停时提亮对应色段/图例色块。
 */
export function StackedBar({
  title,
  items,
  empty = "暂无数据",
}: {
  title?: string;
  items: { label: string; value: number; tone: Tone }[];
  empty?: string;
}) {
  const total = items.reduce((s, i) => s + (Number.isFinite(i.value) ? i.value : 0), 0);
  const pctOf = (v: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0);
  return (
    <div>
      {title && <div className="mb-2 text-xs text-neutral-500">{title}</div>}
      <div
        className="flex h-2.5 w-full overflow-hidden border border-neutral-200 bg-neutral-100"
        role="img"
        aria-label={`${title ?? "构成"}：${items
          .map((i) => `${i.label} ${i.value}（${pctOf(i.value)}%）`)
          .join("；")}，共 ${total}`}
      >
        {total > 0 &&
          items
            .filter((i) => i.value > 0)
            .map((i) => (
              <span
                key={i.label}
                title={`${i.label} ${i.value.toLocaleString()}（${pctOf(i.value)}%）`}
                className={`${TONE_BG[i.tone]} transition-[filter] hover:brightness-110`}
                style={{ width: `${(i.value / total) * 100}%` }}
              />
            ))}
      </div>
      {total === 0 ? (
        <p className="mt-2 text-xs text-neutral-400">{empty}</p>
      ) : (
        <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
          {items.map((i) => (
            <li
              key={i.label}
              title={`${i.label} ${i.value.toLocaleString()}（占 ${pctOf(i.value)}%）`}
              className="group flex items-center justify-between gap-2 text-xs"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-neutral-500">
                <span
                  className={`inline-block h-2 w-2 shrink-0 ${TONE_BG[i.tone]} transition-[filter] group-hover:brightness-110`}
                  aria-hidden
                />
                <span className="truncate group-hover:text-neutral-800">{i.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-neutral-900">
                {i.value.toLocaleString()}
                <span className="ml-1 text-neutral-400">{pctOf(i.value)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
