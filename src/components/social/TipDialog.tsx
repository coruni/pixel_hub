"use client";

// 打赏浮层 —— 「打赏作品」与「直接打赏作者」共用（两者 UI 与校验完全一致，只差提交目标：
// TipRecord.resourceId 有没有值）。所以面板只收一个 `onSubmit`，不关心钱是打给作品还是打给人。
//
// 【幂等】每次打开（挂载）生成一个新 token 随提交带上；服务端按 `tip:<token>` 去重，
// 连点或网络重试只会产生一笔打赏。关闭即作废，避免「上次失败的那笔」被重放。
//
// 【为什么不用原生 confirm】与全站一致：拒绝 window.alert / confirm，用遵循像素语言的定制浮层。
import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { INPUT_SM } from "@/lib/ui/cls";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/feedback";
import { useAction, type ActionResult } from "@/lib/hooks";
import { formatCoin } from "@/lib/money";
import type { TipForm } from "@/lib/points-config";

function newTipToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type TipSubmitInput = { coin: number; message: string; token: string };

export default function TipDialog({
  onClose,
  form,
  title,
  note,
  onSubmit,
}: {
  onClose: () => void;
  form: TipForm;
  /** 面板标题（「打赏作品」/「打赏 @xxx」） */
  title: string;
  /** 面板顶部的说明：收款方与「不产生贡献分」这两件事必须说清（后台文案口径） */
  note: ReactNode;
  onSubmit: (input: TipSubmitInput) => Promise<ActionResult>;
}) {
  const [coin, setCoin] = useState(form.presets[0] ?? form.minCoin);
  const [message, setMessage] = useState("");
  const [token] = useState(newTipToken);
  const { run, pending } = useAction();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const valid = coin >= form.minCoin && coin <= form.maxCoin;

  const submit = () =>
    run(async () => {
      const r = await onSubmit({ coin, message, token });
      if (r.ok) {
        toast(`已打赏 ${formatCoin(coin, form.symbol)}，感谢支持`, "success");
        setMessage("");
        onClose();
      }
      return r;
    });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm border border-brand-300 bg-surface p-4 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
            <p className="mt-1 text-[11px] leading-4 text-neutral-500">{note}</p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={onClose}
            className="shrink-0 p-1 text-neutral-400 transition hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <X size={15} aria-hidden />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {form.presets.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={coin === p}
              onClick={() => setCoin(p)}
              className={`min-h-9 rounded-none border px-3 text-xs tabular-nums transition focus-visible:ring-2 focus-visible:ring-brand-400 ${
                coin === p
                  ? "border-brand-600 bg-brand-500 font-medium text-white"
                  : "border-brand-200 bg-surface text-neutral-700 hover:border-brand-500"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-neutral-700">
            数量（{form.symbol}）
          </span>
          <input
            type="number"
            inputMode="numeric"
            step={1}
            min={form.minCoin}
            max={form.maxCoin}
            value={coin}
            onChange={(e) => setCoin(Math.trunc(Number(e.target.value) || 0))}
            className={`${INPUT_SM} w-full text-right tabular-nums`}
          />
          <span className="mt-1 block text-[11px] text-neutral-400">
            可打赏 {form.minCoin} – {form.maxCoin} {form.symbol}
          </span>
        </label>

        {form.messageMax > 0 && (
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-neutral-700">附言（可选）</span>
            <input
              type="text"
              maxLength={form.messageMax}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={`${INPUT_SM} w-full`}
              placeholder={`最多 ${form.messageMax} 字`}
            />
          </label>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="action" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={pending || !valid}
            onClick={submit}
            variant="primary"
          >
            {pending ? "提交中…" : `打赏 ${coin} ${form.symbol}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
