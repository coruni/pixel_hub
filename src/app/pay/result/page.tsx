import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { prisma } from "@/lib/db/prisma";
import { formatYuan } from "@/lib/money";
import PayRefreshButton from "@/components/fund/PayRefreshButton";

export const metadata: Metadata = { title: "赞助结果", robots: { index: false } };
export const dynamic = "force-dynamic";

const states = {
  PAID: {
    icon: CheckCircle2,
    tone: "border-emerald-300 bg-emerald-50 text-emerald-700",
    title: "已到账，谢谢你",
    body: "这笔赞助已计入当月收入，出现在资金池公示页的收支明细里，也留在了鸣谢墙上。",
  },
  PENDING: {
    icon: Clock,
    tone: "border-amber-300 bg-amber-50 text-amber-700",
    title: "支付处理中",
    body: "第三方收银台还没把结果确认给我们。通常是几秒到几分钟的事；如果你确实已经付款，可以手动查一次。",
  },
  CLOSED: {
    icon: AlertTriangle,
    tone: "border-neutral-300 bg-neutral-100 text-neutral-600",
    title: "这笔订单已关闭",
    body: "订单超时未支付或被放弃。没有产生任何扣款，也不会出现在收支明细里。",
  },
  REFUNDED: {
    icon: AlertTriangle,
    tone: "border-neutral-300 bg-neutral-100 text-neutral-600",
    title: "这笔订单已退款",
    body: "款项已退回。退款会作为「赞助退款」冲减收入，明细同样在公示页上可查。",
  },
} as const;

export default async function PayResultPage({
  searchParams,
}: {
  searchParams: Promise<{ out_trade_no?: string }>;
}) {
  const { out_trade_no } = await searchParams;
  const order = out_trade_no
    ? await prisma.paymentOrder.findUnique({
        where: { outTradeNo: out_trade_no.slice(0, 64) },
        select: { outTradeNo: true, amountFen: true, status: true, subject: true },
      })
    : null;

  const st = order ? states[order.status] : null;
  const Icon = st?.icon ?? AlertTriangle;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div
        className={`border px-5 py-6 ${
          st ? st.tone : "border-neutral-300 bg-neutral-100 text-neutral-600"
        }`}
      >
        <div className="flex items-start gap-3">
          <Icon size={20} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">
              {st ? st.title : "没有找到这笔订单"}
            </h1>
            <p className="mt-1.5 text-sm leading-6">{st ? st.body : "链接可能已失效，或订单号不正确。"}</p>
          </div>
        </div>
      </div>

      {order && (
        <dl className="mt-4 divide-y divide-brand-100 border border-brand-200 bg-surface">
          {[
            { label: "金额", value: formatYuan(order.amountFen) },
            { label: "项目", value: order.subject },
            { label: "订单号", value: order.outTradeNo },
          ].map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 px-4 py-3">
              <dt className="shrink-0 text-xs text-neutral-500">{row.label}</dt>
              <dd className="min-w-0 break-all text-right text-sm tabular-nums text-neutral-800">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {order && !st?.title.startsWith("已到账") && order.status === "PENDING" && (
          <PayRefreshButton outTradeNo={order.outTradeNo} />
        )}
        <Link
          href="/fund"
          className="inline-flex min-h-9 items-center rounded-none border border-brand-200 bg-surface px-3 text-xs text-neutral-700 transition hover:border-brand-500 hover:text-brand-700"
        >
          返回资金池公示
        </Link>
      </div>

      <p className="mt-6 text-[11px] leading-5 text-neutral-400">
        赞助不会带来任何额外功能、身份或特权。所有收支都在资金池公示页上逐笔可查。
      </p>
    </div>
  );
}
