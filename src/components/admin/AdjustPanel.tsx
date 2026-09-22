"use client";

// 人工调整面板（挂在 /admin/incentive 配置表单**之外**——配置表单本身是一个 <form>，
// 嵌套 form 是非法 HTML，浏览器会把内层表单丢掉）。
//
// 流程刻意是「先查、再改」：调整前必须看到目标的当前分值/代币，否则很容易改错人。
// 每一次调整都要填理由，服务端会连同操作人一起写 `AuditLog`。
import { useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/feedback";
import { useAction } from "@/lib/hooks";
import { INPUT_SM, LABEL_STRONG } from "@/lib/ui/cls";
import { formatCoin } from "@/lib/money";
import {
  adjustCoinAction,
  adjustPointsAction,
  lookupAdjustTargetAction,
  type AdjustTarget,
} from "@/lib/actions/adjust";

export default function AdjustPanel({ symbol }: { symbol: string }) {
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  const [target, setTarget] = useState<AdjustTarget | null>(null);
  const [pointsDelta, setPointsDelta] = useState("");
  const [pointsNote, setPointsNote] = useState("");
  const [coinDelta, setCoinDelta] = useState("");
  const [coinNote, setCoinNote] = useState("");

  function lookup() {
    run(async () => {
      const r = await lookupAdjustTargetAction(name);
      if (!r.ok) {
        setTarget(null);
        return r;
      }
      setTarget(r.target);
      return { ok: true };
    });
  }

  function applyPoints(sign: 1 | -1) {
    if (!target) return;
    const n = Math.trunc(Number(pointsDelta));
    if (!Number.isFinite(n) || n <= 0) {
      toast("请填写正的调整数量", "error");
      return;
    }
    run(async () => {
      const r = await adjustPointsAction({ username: target.username, delta: sign * n, note: pointsNote });
      if (r.ok) {
        setPointsDelta("");
        setPointsNote("");
        const fresh = await lookupAdjustTargetAction(target.username);
        if (fresh.ok) setTarget(fresh.target);
      }
      return r;
    });
  }

  function applyCoin(sign: 1 | -1) {
    if (!target) return;
    const n = Math.trunc(Number(coinDelta));
    if (!Number.isFinite(n) || n <= 0) {
      toast("请填写正的调整数量", "error");
      return;
    }
    run(async () => {
      const r = await adjustCoinAction({ username: target.username, delta: sign * n, note: coinNote });
      if (r.ok) {
        setCoinDelta("");
        setCoinNote("");
        const fresh = await lookupAdjustTargetAction(target.username);
        if (fresh.ok) setTarget(fresh.target);
      }
      return r;
    });
  }

  return (
    <section className="mt-4 overflow-hidden border border-brand-200 bg-surface">
      <div className="border-b border-brand-100 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand-50 text-brand-600">
            <ShieldAlert size={18} strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900">人工调整</h2>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              补记漏算的贡献分、扣掉刷出来的分、补偿或追回代币。先查目标再调整，每次都要填理由 ——
              这里每一笔都会连同操作人写进操作日志。人工调整不受冻结名单拦截（冻结只停自动计分）。
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label className={LABEL_STRONG} htmlFor="adj-name">
              用户名
            </label>
            <input
              id="adj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  lookup();
                }
              }}
              placeholder="不含 @ 的用户名"
              className={`${INPUT_SM} w-full`}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={pending || !name.trim()}
            onClick={lookup}
            className="min-h-9"
          >
            <Search size={13} aria-hidden /> 查询
          </Button>
        </div>

        {target ? (
          <>
            <dl className="grid grid-cols-2 gap-2 border border-brand-100 bg-background p-3 sm:grid-cols-4">
              <div className="min-w-0">
                <dt className="text-[11px] text-neutral-500">账号</dt>
                <dd className="mt-0.5 truncate text-sm text-neutral-900">
                  {target.name ?? target.username}
                  <span className="ml-1 text-[11px] text-neutral-400">@{target.username}</span>
                  {target.frozen && (
                    <span className="ml-2 rounded-none border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                      计分已冻结
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-neutral-500">贡献分</dt>
                <dd className="mt-0.5 text-sm tabular-nums text-neutral-900">
                  {target.points.toLocaleString("zh-CN")}
                  <span className="ml-1 text-[11px] text-neutral-400">（等级 {target.level + 1}）</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-neutral-500">可用 {symbol}</dt>
                <dd className="mt-0.5 text-sm tabular-nums text-neutral-900">
                  {formatCoin(target.coin.balance, symbol)}
                  {target.coin.frozen > 0 && (
                    <span className="ml-1 text-[11px] text-neutral-400">
                      冻结 {target.coin.frozen}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-neutral-500">累计获得 / 提现</dt>
                <dd className="mt-0.5 text-sm tabular-nums text-neutral-900">
                  {target.coin.lifetimeEarned} / {target.coin.lifetimeWithdrawn}
                </dd>
              </div>
            </dl>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* 贡献分 */}
              <div className="border border-brand-100 p-3">
                <h3 className="text-xs font-medium text-neutral-700">调整贡献分</h3>
                <p className="mt-1 text-[11px] leading-4 text-neutral-400">
                  贡献分是荣誉层，只增不减是常态；扣分用于修正被刷出来的分值。扣到负数会被拒绝。
                </p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="w-28">
                    <label className="sr-only" htmlFor="adj-p-n">
                      贡献分数量
                    </label>
                    <input
                      id="adj-p-n"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={pointsDelta}
                      onChange={(e) => setPointsDelta(e.target.value)}
                      placeholder="数量"
                      className={`${INPUT_SM} w-full tabular-nums`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="sr-only" htmlFor="adj-p-note">
                      理由
                    </label>
                    <input
                      id="adj-p-note"
                      value={pointsNote}
                      maxLength={200}
                      onChange={(e) => setPointsNote(e.target.value)}
                      placeholder="理由（必填，写进操作日志）"
                      className={`${INPUT_SM} w-full`}
                    />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={pending || !pointsDelta || pointsNote.trim().length < 2}
                    onClick={() => applyPoints(1)}
                    className="min-h-8"
                  >
                    <ArrowUpCircle size={13} aria-hidden /> 加分
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending || !pointsDelta || pointsNote.trim().length < 2}
                    onClick={() => applyPoints(-1)}
                    className="min-h-8"
                  >
                    <ArrowDownCircle size={13} aria-hidden /> 扣分
                  </Button>
                </div>
              </div>

              {/* 代币 */}
              <div className="border border-brand-100 p-3">
                <h3 className="text-xs font-medium text-neutral-700">调整 {symbol}</h3>
                <p className="mt-1 text-[11px] leading-4 text-neutral-400">
                  补发会抬高代币负债水位（钱没变多而代币变多）；扣回需要对方可用余额足够。
                  人工补发不计入「累计获得」。
                </p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="w-28">
                    <label className="sr-only" htmlFor="adj-c-n">
                      代币数量
                    </label>
                    <input
                      id="adj-c-n"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={coinDelta}
                      onChange={(e) => setCoinDelta(e.target.value)}
                      placeholder="数量"
                      className={`${INPUT_SM} w-full tabular-nums`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="sr-only" htmlFor="adj-c-note">
                      理由
                    </label>
                    <input
                      id="adj-c-note"
                      value={coinNote}
                      maxLength={200}
                      onChange={(e) => setCoinNote(e.target.value)}
                      placeholder="理由（必填，写进操作日志）"
                      className={`${INPUT_SM} w-full`}
                    />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={pending || !coinDelta || coinNote.trim().length < 2}
                    onClick={() => applyCoin(1)}
                    className="min-h-8"
                  >
                    <ArrowUpCircle size={13} aria-hidden /> 补发
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending || !coinDelta || coinNote.trim().length < 2}
                    onClick={() => applyCoin(-1)}
                    className="min-h-8"
                  >
                    <ArrowDownCircle size={13} aria-hidden /> 扣回
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-neutral-400">
            先查询一个账号，确认是本人之后再调整。
          </p>
        )}
      </div>
    </section>
  );
}
