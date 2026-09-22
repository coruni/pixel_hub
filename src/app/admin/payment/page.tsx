import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { ensurePaymentConfig, getPaymentConfig } from "@/lib/payment-settings";
import { listOrders, sponsorTotals } from "@/lib/payment";
import { formatYuan } from "@/lib/money";
import { str, type SP } from "@/lib/search-params";
import type { OrderStatus } from "@prisma/client";
import PaymentManager, { type PaymentView } from "@/components/admin/PaymentManager";
import PaymentOrders, { type OrderView } from "@/components/admin/PaymentOrders";

export const metadata: Metadata = { title: "支付设置" };

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "PENDING", label: "待支付" },
  { value: "PAID", label: "已支付" },
  { value: "REFUNDED", label: "已退款" },
  { value: "CLOSED", label: "已关闭" },
];

export default async function AdminPaymentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/admin");

  await ensurePaymentConfig();
  const cfg = await getPaymentConfig();

  const sp = await searchParams;
  const statusRaw = str(sp, "status") ?? "";
  const status = STATUS_TABS.some((t) => t.value === statusRaw && t.value)
    ? (statusRaw as OrderStatus)
    : undefined;

  const [orders, totals] = await Promise.all([
    listOrders({ status, take: 50 }),
    sponsorTotals(),
  ]);

  // 【密钥不出服务端】只挑非机密字段下发。**不要**写 `{...cfg.epay}` 再删 key ——
  // 白名单式构造能让「漏掉一个机密字段」变成不可能，而不是靠每次改代码时记得删。
  const view: PaymentView = {
    epay: {
      enabled: cfg.epay.enabled,
      url: cfg.epay.url,
      pid: cfg.epay.pid,
      alipay: cfg.epay.alipay,
      wxpay: cfg.epay.wxpay,
    },
    sponsor: { ...cfg.sponsor, tiers: [...cfg.sponsor.tiers] },
    order: { ...cfg.order },
    keySet: cfg.epay.key.length > 0,
  };

  const rows: OrderView[] = orders.map((o) => ({ ...o }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">支付设置</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          收款通道与站点赞助入口。赞助是**唯一的外部收入来源**，也是创作者激励池的原料 ——
          没有收入，结算闸门会一直卡在「可用资金不足」。
        </p>
      </div>

      <PaymentManager view={view} />

      <section className="border border-brand-200 bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-100 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-neutral-900">赞助订单</h3>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              累计 {totals.count} 笔已支付订单，净额 {formatYuan(totals.amountFen)}（已扣退款）。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_TABS.map((t) => {
              const active = (status ?? "") === t.value;
              return (
                <Link
                  key={t.value || "all"}
                  href={t.value ? `/admin/payment?status=${t.value}` : "/admin/payment"}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-none border px-2 py-1 text-[11px] transition ${
                    active
                      ? "border-brand-600 bg-brand-500 text-white"
                      : "border-brand-200 bg-surface text-neutral-600 hover:border-brand-500"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="px-4 py-3">
          <PaymentOrders orders={rows} />
        </div>
      </section>
    </div>
  );
}
