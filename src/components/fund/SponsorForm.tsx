"use client";

// 赞助表单（客户端）。**用原生 form POST 提交到 /api/pay/create**，
// 不用 fetch：接口返回的是 303 跳转到站外收银台，只有浏览器自己发起的导航才能跟过去。
//
// 文案纪律（公益站调性）：一律「赞助 / 支持」，禁止 VIP / 会员 / 解锁 / 特权。
// 自检：把「付费」换成「捐赠」，这句话还成立吗？
import { useState } from "react";
import { AlertTriangle, Heart, ShieldCheck } from "lucide-react";
import { INPUT, INPUT_SM } from "@/lib/ui/cls";
import { fenToYuanText, parseYuanToFen } from "@/lib/money";

export default function SponsorForm({
  tiers,
  minFen,
  maxFen,
  allowAnonymous,
  allowGuest,
  messageMax,
  channels,
  ready,
  loggedIn,
  error,
}: {
  tiers: number[];
  minFen: number;
  maxFen: number;
  allowAnonymous: boolean;
  allowGuest: boolean;
  messageMax: number;
  channels: { alipay: boolean; wxpay: boolean };
  ready: boolean;
  loggedIn: boolean;
  error?: string | null;
}) {
  const defaultAmount = fenToYuanText(tiers[0] ?? minFen);
  const [amount, setAmount] = useState(defaultAmount);
  const [anonymous, setAnonymous] = useState(false);

  const anyChannel = channels.alipay || channels.wxpay;
  const disabled = !ready || !anyChannel || (!loggedIn && !allowGuest);

  const parsed = parseYuanToFen(amount);
  const amountBad =
    parsed === null || parsed < minFen || parsed > maxFen
      ? `请输入 ${fenToYuanText(minFen)} – ${fenToYuanText(maxFen)} 元之间的金额`
      : null;

  const chip = (active: boolean) =>
    `min-h-9 rounded-none border px-3 text-xs tabular-nums transition focus-visible:ring-2 focus-visible:ring-brand-400 ${
      active
        ? "border-brand-600 bg-brand-500 font-medium text-white"
        : "border-brand-200 bg-surface text-neutral-700 hover:border-brand-500"
    }`;

  return (
    <form
      className="border border-brand-200 bg-surface p-4 sm:p-5"
      action="/api/pay/create"
      method="post"
    >
      <div className="flex items-start gap-2">
        <Heart size={16} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">赞助本站</h2>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            赞助用于覆盖服务器、存储与域名的实际开销。它不会带来任何额外功能、身份或特权
            —— 赞助与否，你看到和用到的东西完全一样。
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-1.5 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}

      {!ready || !anyChannel ? (
        <p className="mt-4 flex items-start gap-1.5 border border-dashed border-brand-300 px-3 py-3 text-xs text-neutral-500">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>赞助通道暂未开放。在此之前，站内每一笔收支都已公示在本页上方。</span>
        </p>
      ) : (
        <>
          <div className="mt-4">
            <p className="text-xs font-medium text-neutral-700">选择金额</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tiers.map((t) => {
                const text = fenToYuanText(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={amount === text}
                    onClick={() => setAmount(text)}
                    className={chip(amount === text)}
                  >
                    ¥{text}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">赞助金额（元）</span>
              <input
                name="amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-describedby="sponsor-amount-hint"
                className={INPUT}
              />
              <span id="sponsor-amount-hint" className="mt-1 block text-[11px] text-neutral-400">
                {amountBad ?? `可填 ${fenToYuanText(minFen)} – ${fenToYuanText(maxFen)} 元`}
              </span>
            </label>

            <fieldset>
              <legend className="mb-1 block text-xs font-medium text-neutral-700">支付方式</legend>
              <div className="flex flex-wrap gap-2">
                {channels.alipay && (
                  <label className="flex min-h-9 cursor-pointer items-center gap-1.5 border border-brand-200 bg-surface px-3 text-xs text-neutral-700 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                    <input
                      type="radio"
                      name="payType"
                      value="alipay"
                      defaultChecked
                      className="h-3.5 w-3.5 rounded-none accent-brand-500"
                    />
                    支付宝
                  </label>
                )}
                {channels.wxpay && (
                  <label className="flex min-h-9 cursor-pointer items-center gap-1.5 border border-brand-200 bg-surface px-3 text-xs text-neutral-700 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                    <input
                      type="radio"
                      name="payType"
                      value="wxpay"
                      defaultChecked={!channels.alipay}
                      className="h-3.5 w-3.5 rounded-none accent-brand-500"
                    />
                    微信
                  </label>
                )}
              </div>
            </fieldset>
          </div>

          {messageMax > 0 && (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium text-neutral-700">
                留言（可选，会显示在鸣谢墙）
              </span>
              <input
                name="message"
                type="text"
                maxLength={messageMax}
                className={INPUT_SM + " w-full"}
                placeholder={`最多 ${messageMax} 字`}
              />
            </label>
          )}

          {allowAnonymous && (
            <label className="mt-3 flex items-center gap-2 text-xs text-neutral-700">
              <input
                type="checkbox"
                name="anonymous"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
                className="h-4 w-4 rounded-none border border-brand-300 accent-brand-500"
              />
              匿名赞助（鸣谢墙显示为「一位路过的朋友」）
            </label>
          )}

          {!loggedIn && allowGuest && (
            <p className="mt-3 text-[11px] text-neutral-400">
              未登录也可以赞助。登录后赞助会在鸣谢墙上留下你的用户名。
            </p>
          )}

          <button
            type="submit"
            disabled={disabled || !!amountBad}
            className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-none border border-brand-600 bg-brand-500 px-4 text-sm font-medium text-white transition hover:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 sm:w-auto"
          >
            <Heart size={14} aria-hidden />
            去赞助
          </button>

          <p className="mt-2 text-[11px] leading-4 text-neutral-400">
            跳转到第三方收银台完成支付。支付结果会回到本站，到账后自动计入当月收入并出现在上方明细里。
          </p>
        </>
      )}
    </form>
  );
}
