// 资金池水位条（纯展示，无状态、无数据依赖 —— 三个入参就是全部输入）。
//
// 形态遵守现有视觉语言：直角双色条、无渐变；安全线用 neutral-400 虚线；
// 越线转 red。**只显示总额，不显示任何个人余额** —— 资金池页一旦出现个人数字就变成财富榜。
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { formatYuan } from "@/lib/money";

export default function PoolMeter({
  cashFen,
  liabilityFen,
  bufferPermille,
  showSafetyLine,
  perYuan,
}: {
  /** 可用现金 C（分） */
  cashFen: number;
  /** PIX 负债 L（分） */
  liabilityFen: number;
  /** 安全水位（万分比），安全线画在 1 − buffer 处 */
  bufferPermille: number;
  showSafetyLine: boolean;
  /** 兑换比例（PIX/元），仅用于文案里说明换算口径 */
  perYuan: number;
}) {
  const ratio = cashFen > 0 ? liabilityFen / cashFen : liabilityFen > 0 ? 1 : 0;
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const safePct = Math.max(0, Math.min(100, (100 - bufferPermille / 100) * 100));
  const over = ratio * 100 > safePct + 0.001;

  return (
    <section className="border border-brand-200 bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">资金池水位</h2>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            站点账上的真钱是「可用资金」；创作者手上还没提现的代币折算成钱，是「代币负债」。
            两条数字的相对位置就是这条水位。安全线以下，新结算才放行；越过安全线，
            新结算会暂缓到收入到账后处理 —— 这是为了保住已发出的代币能真的兑付。
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 border px-2 py-1 text-[11px] ${
            over
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-emerald-300 bg-emerald-50 text-emerald-700"
          }`}
        >
          {over ? <AlertTriangle size={12} aria-hidden /> : <ShieldCheck size={12} aria-hidden />}
          {over ? "已越过安全线" : "安全线以内"}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="border border-brand-100 bg-background px-3 py-2">
          <dt className="text-[11px] text-neutral-500">可用资金</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-900">
            {formatYuan(cashFen)}
          </dd>
        </div>
        <div className="border border-brand-100 bg-background px-3 py-2">
          <dt className="text-[11px] text-neutral-500">创作者代币负债</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-brand-700">
            {formatYuan(liabilityFen)}
          </dd>
        </div>
        <div className="border border-brand-100 bg-background px-3 py-2">
          <dt className="text-[11px] text-neutral-500">负债 / 可用资金</dt>
          <dd
            className={`mt-0.5 text-lg font-semibold tabular-nums ${over ? "text-red-700" : "text-neutral-900"}`}
          >
            {(ratio * 100).toFixed(1)}%
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <div
          className="relative h-4 w-full border border-brand-200 bg-background"
          role="img"
          aria-label={`代币负债占可用资金 ${(ratio * 100).toFixed(1)}%，安全线 ${(safePct).toFixed(0)}%`}
        >
          <div
            className={`h-full ${over ? "bg-red-500" : "bg-brand-500"}`}
            style={{ width: `${pct}%` }}
          />
          {showSafetyLine && (
            <div
              className="absolute inset-y-0 border-l border-dashed border-neutral-400"
              style={{ left: `${safePct}%` }}
            />
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-neutral-500">
          <span>
            安全线 {safePct.toFixed(0)}%（安全水位 {((10000 - bufferPermille) / 100).toFixed(0)}% 可用）
          </span>
          <span>1 元 = {perYuan} 代币</span>
        </div>
      </div>

      {over && (
        <p className="mt-3 border border-red-300 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
          当前创作者代币负债已达可用资金的 {(ratio * 100).toFixed(1)}%，已超过安全线。
          新结算会暂缓到收入到账后处理 —— 这是为了保护已发出的代币能真的兑付。
        </p>
      )}
    </section>
  );
}
