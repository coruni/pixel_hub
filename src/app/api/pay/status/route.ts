import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/origin";
import { ipFromHeaders } from "@/lib/ip";
import { syncOrder } from "@/lib/payment";

// 主动查单兜底：回调可能丢失（网络、上游重试耗尽），/pay/result 的「刷新状态」调这里。
// 不依赖常驻 cron —— 只在用户主动点的时候发一次上游请求。
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "跨站请求被拒" }, { status: 403 });

  const ip = ipFromHeaders(req.headers);
  if (!(await rateLimit(`pay:status:${ip}`, 20, 60_000))) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { outTradeNo?: unknown } | null;
  const outTradeNo = typeof body?.outTradeNo === "string" ? body.outTradeNo.slice(0, 64) : "";
  if (!outTradeNo) return NextResponse.json({ error: "缺少订单号" }, { status: 400 });

  const order = await prisma.paymentOrder.findUnique({
    where: { outTradeNo },
    select: { userId: true, status: true },
  });
  if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  // 归属校验：已登录者的订单只能本人查；游客订单靠不可预测的订单号 + 限流保护
  if (order.userId) {
    const session = await auth();
    if (session?.user?.id !== order.userId) {
      return NextResponse.json({ error: "无权查看该订单" }, { status: 403 });
    }
  }

  if (order.status === "PAID" || order.status === "REFUNDED") {
    return NextResponse.json({ status: order.status, paid: true });
  }

  const res = await syncOrder(outTradeNo);
  return NextResponse.json({
    status: res.paid ? "PAID" : "PENDING",
    paid: res.paid,
    ...(res.error ? { notice: res.error } : {}),
  });
}
