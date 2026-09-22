// 收支明细表（服务端组件）：收入 / 成本 / 创作者提现打款 三组，每笔记日期、事项、金额、备注。
//
// 「每个数字都能追到一条记录」是这一页的铁律，所以这里只做映射与求和，不做任何推算。
// `showAmounts` 关掉时只显示分组小计 —— 公开到「一个数」还是「逐笔」是可配置的。
import { formatYuan } from "@/lib/money";
import { LEDGER_KIND_META, type LedgerKind } from "@/lib/payment-config";
import type { LedgerRow } from "@/lib/ledger";
import { dayKey } from "@/lib/format";

type Group = "income" | "cost" | "payout" | "refund";

const GROUPS: { key: Group; title: string; hint: string }[] = [
  { key: "income", title: "收入", hint: "广告、赞助与其他收入的实收记录" },
  { key: "cost", title: "成本", hint: "服务器、存储、域名等运营支出" },
  { key: "payout", title: "创作者提现打款", hint: "已实际转出给创作者的钱" },
  { key: "refund", title: "赞助退款", hint: "退回给赞助者的钱（冲减收入）" },
];

function groupOf(kind: string): Group {
  const meta = LEDGER_KIND_META[kind as LedgerKind];
  if (!meta) return "cost";
  if (meta.direction === "IN") return "income";
  if (meta.group === "payout") return "payout";
  if (meta.group === "refund") return "refund";
  return "cost";
}

export default function LedgerTable({
  rows,
  showAmounts,
}: {
  rows: LedgerRow[];
  showAmounts: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="border border-dashed border-brand-300 px-4 py-8 text-center text-sm text-neutral-500">
        这个月还没有收支记录。每一笔到账与支出都会在这里逐条列出。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {GROUPS.map((g) => {
        const items = rows.filter((r) => groupOf(r.kind) === g.key);
        if (items.length === 0) return null;
        const total = items.reduce((s, r) => s + r.amountFen, 0);
        const isOut = g.key !== "income";
        return (
          <div key={g.key} className="border border-brand-200 bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-brand-100 px-3 py-2.5 sm:px-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-neutral-900">{g.title}</h3>
                <p className="mt-0.5 text-[11px] text-neutral-500">{g.hint}</p>
              </div>
              <span
                className={`shrink-0 text-sm font-medium tabular-nums ${
                  isOut ? "text-neutral-700" : "text-emerald-700"
                }`}
              >
                {isOut ? "−" : "+"}
                {formatYuan(total)}
              </span>
            </div>
            <ul className="divide-y divide-brand-100">
              {items.map((r) => (
                <li
                  key={r.id}
                  className="grid grid-cols-1 gap-1 px-3 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-3 sm:px-4"
                >
                  <span className="text-[11px] tabular-nums text-neutral-400">
                    {dayKey(r.createdAt)}
                  </span>
                  <span className="min-w-0">
                    <span className="text-xs text-neutral-700">
                      {LEDGER_KIND_META[r.kind]?.label ?? r.kind}
                    </span>
                    {r.note && (
                      <span className="ml-2 text-[11px] text-neutral-400">{r.note}</span>
                    )}
                  </span>
                  {showAmounts && (
                    <span className="text-xs tabular-nums text-neutral-700 sm:text-right">
                      {isOut ? "−" : "+"}
                      {formatYuan(r.amountFen)}
                    </span>
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
