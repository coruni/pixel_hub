"use client";

// 赞助订单列表（/admin/payment）。
//
// 【补单是唯一「不经验签入账」的通道】上游到账但回调丢失时才用它，所以强制填理由（≥4 字）
// 并写操作日志。补单不改金额 —— 金额以订单表为准，否则「补单」就成了「想给谁多少钱就给多少」。
//
// 退款直接打 `/api/pay/refund`（路由而非 server action）：退款要与上游同步通信，
// 超时/失败需要明确的 HTTP 语义。
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { confirmDialog, promptDialog, toast } from "@/components/ui/feedback";
import { useAction } from "@/lib/hooks";
import { fenToYuanText, formatYuan } from "@/lib/money";
import { dayKey } from "@/lib/format";
import { manualSettleOrderAction } from "@/lib/actions/payment";

export type OrderView = {
  id: string;
  outTradeNo: string;
  amountFen: number;
  refundedFen: number;
  status: string;
  payType: string | null;
  epayTradeNo: string | null;
  paidAt: Date | null;
  message: string | null;
  periodKey: string | null;
  createdAt: Date;
  buyer: string | null;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "待支付", cls: "border-amber-300 bg-amber-50 text-amber-700" },
  PAID: { label: "已支付", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  CLOSED: { label: "已关闭", cls: "border-neutral-300 bg-neutral-50 text-neutral-500" },
  REFUNDED: { label: "已退款", cls: "border-red-300 bg-red-50 text-red-700" },
};

const PAY_TYPE: Record<string, string> = { alipay: "支付宝", wxpay: "微信" };

export default function PaymentOrders({ orders }: { orders: OrderView[] }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onSettle(o: OrderView) {
    const note = await promptDialog({
      title: "查单 / 补单",
      message: `${o.outTradeNo}\n${formatYuan(o.amountFen)}｜${o.buyer ?? "游客"}\n\n会先向上游查单：查到已支付则按上游结果入账；查不到（回调与上游接口都不可用）才会按订单金额强制标记已支付。请填写补单理由。`,
      placeholder: "如：上游回调丢失，已核对商户后台到账",
      required: true,
      multiline: true,
      confirmLabel: "执行",
    });
    if (!note) return;
    run(() => manualSettleOrderAction({ outTradeNo: o.outTradeNo, note }));
  }

  async function onRefund(o: OrderView) {
    const remain = o.amountFen - o.refundedFen;
    const amount = await promptDialog({
      title: "发起退款",
      message: `订单 ${o.outTradeNo}\n可退余额 ${formatYuan(remain)}。退款会同步调用上游，成功后再写冲减台账。`,
      defaultValue: fenToYuanText(remain),
      required: true,
      confirmLabel: "退款",
    });
    if (!amount) return;

    const ok = await confirmDialog({
      title: "确认向支付网关发起退款？",
      message: `订单 ${o.outTradeNo}，退款 ${amount} 元。这是不可撤销的资金动作。`,
      confirmLabel: "确认退款",
      danger: true,
    });
    if (!ok) return;

    setBusyId(o.id);
    try {
      const res = await fetch("/api/pay/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: o.id, amount }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) toast(data?.error ?? "退款失败", "error");
      else {
        toast("退款已提交", "success");
        router.refresh();
      }
    } catch {
      toast("网络异常，退款未提交", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (orders.length === 0) {
    return (
      <p className="border border-dashed border-brand-300 px-4 py-8 text-center text-sm text-neutral-500">
        当前没有符合条件的订单。赞助订单会在用户支付后自动出现在这里。
      </p>
    );
  }

  return (
    <ul className="divide-y divide-brand-100">
      {orders.map((o) => {
        const meta = STATUS_META[o.status] ?? STATUS_META.PENDING!;
        const canRefund = o.status === "PAID";
        const busy = busyId === o.id;
        return (
          <li key={o.id} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium tabular-nums text-neutral-900">
                    {formatYuan(o.amountFen)}
                  </span>
                  <span className={`shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] ${meta.cls}`}>
                    {meta.label}
                  </span>
                  {o.refundedFen > 0 && (
                    <span className="text-[11px] tabular-nums text-red-700">
                      已退 {formatYuan(o.refundedFen)}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {o.buyer ?? "游客"}｜
                  {o.payType ? (PAY_TYPE[o.payType] ?? o.payType) : "—"}｜
                  {o.paidAt ? `支付于 ${dayKey(o.paidAt)}` : `创建于 ${dayKey(o.createdAt)}`}
                  {o.periodKey && <span>｜归属期 {o.periodKey}</span>}
                </p>
                <p className="mt-1 break-all text-[10px] text-neutral-400">
                  订单号 {o.outTradeNo}
                  {o.epayTradeNo && <span>｜网关单号 {o.epayTradeNo}</span>}
                </p>
                {o.message && (
                  <p className="mt-1 break-words border-l-2 border-brand-200 pl-2 text-[11px] text-neutral-600">
                    {o.message}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {o.status === "PENDING" && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending || busy}
                    onClick={() => onSettle(o)}
                    className="min-h-8"
                  >
                    <RefreshCw size={12} aria-hidden /> 查单 / 补单
                  </Button>
                )}
                {canRefund && (
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending || busy}
                    onClick={() => onRefund(o)}
                    className="min-h-8"
                  >
                    <RotateCcw size={12} aria-hidden /> 退款
                  </Button>
                )}
                <a
                  href={`/pay/result?out_trade_no=${o.outTradeNo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-8 items-center gap-1 border border-brand-200 bg-surface px-2.5 text-xs text-neutral-600 transition hover:border-brand-400 hover:text-brand-700"
                >
                  <ExternalLink size={12} aria-hidden /> 结果页
                </a>
              </div>
            </div>
          </li>
        );
      })}
      <li className="pt-3">
        <p className="flex items-start gap-1.5 text-[11px] leading-4 text-neutral-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
          退款只登记「已提交」，真正的资金结果以上游查单为准；冲减台账在退款受理后立即写入，
          因此退款后的可用现金会先减少 —— 这是保守口径，宁可少算也不多算。
        </p>
      </li>
    </ul>
  );
}
