import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sameOrigin } from "@/lib/origin";
import { parseYuanToFen } from "@/lib/money";
import { refundOrder } from "@/lib/payment";
import { audit } from "@/lib/actions/_guards";

// 后台退款端点（adminOnly）。
// 放在路由而不是 server action：退款要与上游同步通信，超时/失败语义需要明确的 HTTP 状态，
// 而且这里天然不该被前台表单直接触发。
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "跨站请求被拒" }, { status: 403 });

  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { orderId?: unknown; amount?: unknown }
    | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  const amountRaw = String(body?.amount ?? "");
  const amountFen = parseYuanToFen(amountRaw);
  if (!orderId) return NextResponse.json({ error: "缺少订单" }, { status: 400 });
  if (amountFen === null || amountFen <= 0) {
    return NextResponse.json({ error: "退款金额不合法" }, { status: 400 });
  }

  const res = await refundOrder(orderId, amountFen, session.user.id);
  if (!res.ok) return NextResponse.json({ error: res.error ?? "退款失败" }, { status: 400 });

  await audit(
    session.user.id,
    "REFUND_ORDER",
    "PAYMENT_ORDER",
    orderId,
    `退款 ${(amountFen / 100).toFixed(2)} 元`,
  );
  return NextResponse.json({ ok: true });
}
