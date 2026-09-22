"use client";

// 手工记账表单（后台 /admin/finance）。
//
// 【为什么要有它】支付通道未上线、或收到通道外的一笔钱（联盟广告打款、赞助方直接转账）时，
// 台账不能是空的 —— 空的台账意味着偿付水位把「可用现金」算成 0，结算会被闸门全部拒掉。
// 所以后台必须能手工补一笔收入/成本。
//
// 【为什么科目是下拉而不是自由文本】科目决定台账方向（IN/OUT）与分组，而方向是
// 「哪笔钱算收入、哪笔算成本」的唯一表达。让人手输科目字符串 = 让方向可以被手输错。
import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { useAction } from "@/lib/hooks";
import { INPUT_SM, LABEL_STRONG } from "@/lib/ui/cls";
import {
  COST_KINDS,
  INCOME_KINDS,
  LEDGER_KIND_META,
} from "@/lib/payment-config";
import { addLedgerAction } from "@/lib/actions/payment";

export default function LedgerEntryForm({ defaultPeriodKey }: { defaultPeriodKey: string }) {
  const { run, pending } = useAction();
  const [kind, setKind] = useState<string>(INCOME_KINDS[0] ?? "INCOME_OTHER");
  const [amount, setAmount] = useState("");
  const [periodKey, setPeriodKey] = useState(defaultPeriodKey);
  const [note, setNote] = useState("");

  const out = LEDGER_KIND_META[kind as keyof typeof LEDGER_KIND_META]?.direction === "OUT";

  function submit(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const r = await addLedgerAction({ kind, amountYuan: amount, periodKey, note });
      if (r.ok) {
        setAmount("");
        setNote("");
      }
      return r;
    });
  }

  return (
    <form onSubmit={submit} className="border border-brand-200 bg-surface">
      <div className="border-b border-brand-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-neutral-900">手工记一笔</h3>
        <p className="mt-0.5 text-[11px] leading-4 text-neutral-500">
          通道外的收支走这里。科目决定这笔钱算收入还是成本，归属期决定它计入哪个月的结算。
          手工录入可多次录，不会被幂等键挡下 —— 所以录错只能靠再记一笔「冲减」来校正，请录前核对。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <label className={LABEL_STRONG} htmlFor="led-kind">
            科目
          </label>
          <select
            id="led-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={`${INPUT_SM} w-full`}
          >
            <optgroup label="收入">
              {INCOME_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LEDGER_KIND_META[k].label}
                </option>
              ))}
            </optgroup>
            <optgroup label="成本">
              {COST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LEDGER_KIND_META[k].label}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="min-w-0">
          <label className={LABEL_STRONG} htmlFor="led-amount">
            金额（元）
          </label>
          <input
            id="led-amount"
            value={amount}
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)}
            placeholder="如：59.90"
            className={`${INPUT_SM} w-full tabular-nums`}
          />
        </div>
        <div className="min-w-0">
          <label className={LABEL_STRONG} htmlFor="led-period">
            归属期
          </label>
          <input
            id="led-period"
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            placeholder="YYYY-MM"
            className={`${INPUT_SM} w-full tabular-nums`}
          />
        </div>
        <div className="min-w-0">
          <label className={LABEL_STRONG} htmlFor="led-note">
            备注（可选）
          </label>
          <input
            id="led-note"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            className={`${INPUT_SM} w-full`}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="primary" disabled={pending || !amount.trim()} className="min-h-9">
            记入台账（{out ? "支出" : "收入"}）
          </Button>
          <span className="ml-3 text-[11px] text-neutral-400">
            所有手工录入都会写入操作日志，可追溯到操作人。
          </span>
        </div>
      </div>
    </form>
  );
}
