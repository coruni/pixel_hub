// 鸣谢墙（服务端组件）：按月份分组列出赞助者 + 月度合计。
//
// 隐私纪律：匿名在**对外视图里一律匿名** —— 上游（payment.thanksWall）已经把
// displayName 抹成 null，这里只负责统一显示为「一位路过的朋友」，
// 不靠每个组件自己记得判 anonymous。
// 单笔金额是否公开由配置决定（默认只显示人次与合计）。
import { formatYuan } from "@/lib/money";
import type { ThanksRow } from "@/lib/payment";
import { dayKey } from "@/lib/format";

export default function ThanksWall({
  rows,
  showAmount,
}: {
  rows: ThanksRow[];
  showAmount: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="border border-dashed border-brand-300 px-4 py-8 text-center text-sm text-neutral-500">
        还没有赞助记录。愿意的话，你可以成为第一个在这里留下名字的人。
      </p>
    );
  }

  // 按月分组（periodKey 即 YYYY-MM，字典序即时间序）
  const byMonth = new Map<string, ThanksRow[]>();
  for (const r of rows) {
    const key = r.periodKey ?? (r.paidAt ? dayKey(r.paidAt).slice(0, 7) : "未知");
    const list = byMonth.get(key);
    if (list) list.push(r);
    else byMonth.set(key, [r]);
  }
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  return (
    <div className="space-y-4">
      {months.map(([month, list]) => {
        const total = list.reduce((s, r) => s + r.amountFen, 0);
        return (
          <div key={month} className="border border-brand-200 bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-brand-100 px-3 py-2.5 sm:px-4">
              <h3 className="text-sm font-semibold text-neutral-900">{month}</h3>
              <span className="text-[11px] text-neutral-500">
                {list.length} 人次 · 合计 {formatYuan(total)}
              </span>
            </div>
            <ul className="flex flex-wrap gap-2 px-3 py-3 sm:px-4">
              {list.map((r) => (
                <li
                  key={r.id}
                  className="border border-brand-100 bg-background px-2.5 py-1.5 text-xs text-neutral-700"
                  title={r.message ? `留言：${r.message}` : undefined}
                >
                  <span className="font-medium">
                    {r.anonymous || !r.displayName ? "一位路过的朋友" : r.displayName}
                  </span>
                  {showAmount && (
                    <span className="ml-2 tabular-nums text-neutral-500">
                      {formatYuan(r.amountFen)}
                    </span>
                  )}
                  {r.message && (
                    <span className="ml-2 text-[11px] text-neutral-400">「{r.message}」</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
