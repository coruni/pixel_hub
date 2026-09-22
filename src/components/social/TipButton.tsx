"use client";

// 详情页打赏按钮 + 打赏面板。
//
// 【为什么不新起一行】打赏与点赞/收藏/关注是同一层的「读完顺手做的事」，
// 所以它沿用 `ACTION_TEXT` 的「图标 + 文字」形态，留在 ActionBar 那一行里（计划 §8）。
// 面板做成自包含的浮层：ActionBar 是 `justify-end` 的单行容器，任何内联展开都会把整行推歪。
//
// 【为什么不用原生 confirm】与全站一致：拒绝 window.alert / confirm，用遵循像素语言的定制浮层。
//
// 【幂等】每次打开面板生成一个一次性 token，随提交带上；服务端按 `tip:<token>` 去重，
// 连点或网络重试只会产生一笔打赏。
import { useEffect, useRef, useState } from "react";
import { Coins, X } from "lucide-react";
import { ACTION_TEXT, BTN_PRIMARY_SM, INPUT_SM } from "@/lib/ui/cls";
import { toast } from "@/components/ui/feedback";
import { useAction } from "@/lib/hooks";
import { sendTipAction } from "@/lib/actions/tip";
import { formatCoin } from "@/lib/money";

export default function TipButton({
  resourceId,
  minCoin,
  maxCoin,
  presets,
  symbol,
  messageMax,
}: {
  resourceId: string;
  minCoin: number;
  maxCoin: number;
  presets: number[];
  symbol: string;
  messageMax: number;
}) {
  const [open, setOpen] = useState(false);
  const [coin, setCoin] = useState(presets[0] ?? minCoin);
  const [message, setMessage] = useState("");
  const tokenRef = useRef<string>("");
  const { run, pending } = useAction();

  // 每次打开面板换一个新 token（关闭即作废，避免「上次失败的那笔」被重放）
  useEffect(() => {
    if (open) {
      tokenRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const valid = coin >= minCoin && coin <= maxCoin;

  const submit = () =>
    run(
      async () => {
        const r = await sendTipAction({
          resourceId,
          coin,
          message,
          token: tokenRef.current,
        });
        if (r.ok) {
          toast(`已打赏 ${formatCoin(coin, symbol)}，感谢支持`, "success");
          setOpen(false);
          setMessage("");
        }
        return r;
      },
      { refresh: true },
    );

  return (
    <>
      <button type="button" className={ACTION_TEXT} onClick={() => setOpen(true)}>
        <Coins size={15} aria-hidden /> 打赏
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="打赏作者"
            className="w-full max-w-sm border border-brand-300 bg-surface p-4 text-left"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-neutral-900">打赏作者</h2>
                <p className="mt-1 text-[11px] leading-4 text-neutral-500">
                  站内 {symbol} 转账，全数归作者，平台不抽成。它不会产生贡献分，
                  也不影响任何榜单 —— 只是替你觉得好的东西付一次钱。
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                title="关闭"
                onClick={() => setOpen(false)}
                className="shrink-0 p-1 text-neutral-400 transition hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <X size={15} aria-hidden />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {presets.map((p) => (
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
                数量（{symbol}）
              </span>
              <input
                type="number"
                inputMode="numeric"
                step={1}
                min={minCoin}
                max={maxCoin}
                value={coin}
                onChange={(e) => setCoin(Math.trunc(Number(e.target.value) || 0))}
                className={`${INPUT_SM} w-full text-right tabular-nums`}
              />
              <span className="mt-1 block text-[11px] text-neutral-400">
                可打赏 {minCoin} – {maxCoin} {symbol}
              </span>
            </label>

            {messageMax > 0 && (
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-medium text-neutral-700">
                  附言（可选）
                </span>
                <input
                  type="text"
                  maxLength={messageMax}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className={`${INPUT_SM} w-full`}
                  placeholder={`最多 ${messageMax} 字`}
                />
              </label>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" className={ACTION_TEXT} onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                type="button"
                disabled={pending || !valid}
                onClick={submit}
                className={BTN_PRIMARY_SM}
              >
                {pending ? "提交中…" : `打赏 ${coin} ${symbol}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
