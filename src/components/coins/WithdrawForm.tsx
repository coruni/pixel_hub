"use client";

// 提现申请表单（客户端）。
// 「元」只在这一处的前台出现（计划 §8）：提现页是唯一出现真实货币金额的地方，
// 其它页面一律只讲代币。/fund 只出聚合总额，不出任何个人金额。
import { useState } from "react";
import { Wallet } from "lucide-react";
import { INPUT, INPUT_SM } from "@/lib/ui/cls";
import { toast } from "@/components/ui/feedback";
import { useAction } from "@/lib/hooks";
import { requestWithdrawalAction } from "@/lib/actions/withdrawal";
import { coinToFen } from "@/lib/points-config";
import { fenToYuanText, formatCoin, formatYuan } from "@/lib/money";

export default function WithdrawForm({
  minCoin,
  feeFen,
  cooldownDays,
  perYuan,
  symbol,
  balance,
  frozen,
}: {
  minCoin: number;
  feeFen: number;
  cooldownDays: number;
  perYuan: number;
  symbol: string;
  balance: number;
  /** 冻结中的代币（提现处理中）：明确告知用户它不能用 */
  frozen: number;
}) {
  const [coin, setCoin] = useState(minCoin);
  const [method, setMethod] = useState<"alipay" | "wechat">("alipay");
  const [name, setName] = useState("");
  const [account, setAccount] = useState("");
  const { run, pending } = useAction();

  // 折算用 coinToFen —— 与 `requestWithdrawalAction` 里服务端算的是**同一个纯函数**。
  // （早先这里用 100/perYuan 预先取整出的「每币分值」，perYuan > 100 时会退化成 0，
  //   用户看到的预计到账与服务端实际打款额不一致。同一公式只应有一份实现。）
  const grossFen = coinToFen(coin, perYuan);
  const estimatedFen = Math.max(0, grossFen - Math.min(feeFen, grossFen));
  const canSubmit =
    coin >= minCoin && coin <= balance && name.trim().length > 0 && account.trim().length > 0;

  const submit = () =>
    run(async () => {
      const r = await requestWithdrawalAction({ coin, method, name, account });
      if (r.ok) {
        toast("提现申请已提交，等待处理", "success");
        setName("");
        setAccount("");
      }
      return r;
    });

  return (
    <section className="border border-brand-200 bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <Wallet size={16} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">提现</h2>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            提交后由站长线下打款，不是自动到账；申请期间这部分代币会冻结。
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-neutral-500">
            <li>· 门槛 {formatCoin(minCoin, symbol)}</li>
            {feeFen > 0 && <li>· 手续费 {formatYuan(feeFen)}</li>}
            {cooldownDays > 0 && <li>· 两次申请至少间隔 {cooldownDays} 天</li>}
          </ul>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="border border-brand-100 bg-background px-3 py-2">
          <dt className="text-[11px] text-neutral-500">可用</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-900">
            {formatCoin(balance, symbol)}
          </dd>
        </div>
        <div className="border border-brand-100 bg-background px-3 py-2">
          <dt className="text-[11px] text-neutral-500">提现处理中</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-600">
            {formatCoin(frozen, symbol)}
          </dd>
        </div>
        <div className="border border-brand-100 bg-background px-3 py-2">
          <dt className="text-[11px] text-neutral-500">本次预计到账</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-brand-700">
            {formatYuan(estimatedFen)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-700">
            提现数量（{symbol}）
          </span>
          <input
            type="number"
            inputMode="numeric"
            step={1}
            min={minCoin}
            value={coin}
            onChange={(e) => setCoin(Math.trunc(Number(e.target.value) || 0))}
            className={`${INPUT} text-right tabular-nums`}
          />
          <span className="mt-1 block text-[11px] text-neutral-400">
            {coin > balance
              ? `超出可用余额（${balance}）`
              : coin < minCoin
                ? `不低于门槛 ${minCoin}`
                : `折合 ${fenToYuanText(grossFen)} 元，实付 ${fenToYuanText(estimatedFen)} 元`}
          </span>
        </label>

        <fieldset>
          <legend className="mb-1 block text-xs font-medium text-neutral-700">收款方式</legend>
          <div className="flex gap-2">
            {(
              [
                { v: "alipay", label: "支付宝" },
                { v: "wechat", label: "微信" },
              ] as const
            ).map((o) => (
              <label
                key={o.v}
                className={`flex min-h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 border px-3 text-xs transition ${
                  method === o.v
                    ? "border-brand-600 bg-brand-50 font-medium text-brand-700"
                    : "border-brand-200 bg-surface text-neutral-700 hover:border-brand-500"
                }`}
              >
                <input
                  type="radio"
                  name="method"
                  value={o.v}
                  checked={method === o.v}
                  onChange={() => setMethod(o.v)}
                  className="h-3.5 w-3.5 rounded-none accent-brand-500"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-700">收款人姓名</span>
          <input
            type="text"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${INPUT_SM} w-full`}
            autoComplete="name"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-700">收款账号</span>
          <input
            type="text"
            maxLength={120}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className={`${INPUT_SM} w-full`}
            placeholder={method === "alipay" ? "支付宝账号" : "微信号"}
          />
        </label>
      </div>

      <p className="mt-3 text-[11px] leading-4 text-neutral-400">
        收款信息只有站长能看到，不进日志、不进任何公开页面；本站不代扣代缴，税务请自行确认。
      </p>

      <button
        type="button"
        disabled={pending || !canSubmit}
        onClick={submit}
        className="mt-3 inline-flex min-h-10 items-center justify-center rounded-none border border-brand-600 bg-brand-500 px-4 text-sm font-medium text-white transition hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
      >
        {pending ? "提交中…" : "提交提现申请"}
      </button>
    </section>
  );
}
