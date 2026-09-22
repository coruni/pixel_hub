import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/origin";
import { hashIp, ipFromHeaders } from "@/lib/ip";
import { requestSiteUrl } from "@/lib/request-origin";
import { getPaymentConfig, getPublicPaymentConfig } from "@/lib/payment-settings";
import { parseYuanToFen } from "@/lib/money";
import { createSponsorOrder } from "@/lib/payment";

// 单笔金额上界的硬闸门（配置另有更细的上下限，这里是「配置被改坏」时的最后一道）：
// 单次请求解析出的分不可能超过 100 万元。
const ABSOLUTE_MAX_FEN = 100_000_000;

/**
 * 创建赞助订单 → 302 跳上游收银台。
 *
 * 为什么用路由而不是 server action：跳转到**站外**地址只能靠 Response.redirect，
 * server action 返回值会被序列化回页面，反而要多一层中转。
 *
 * 未登录也可赞助（赞助是「支持」不是「权益」，没理由要求先登录）——
 * 但只有当后台把 `allowGuest` 关掉时才强制登录。
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "跨站请求被拒" }, { status: 403 });

  const ip = ipFromHeaders(req.headers);
  const cfg = await getPaymentConfig();
  if (!(await rateLimit(`pay:create:${ip}`, cfg.order.ratePerMinute, 60_000))) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });

  const amountRaw = String(form.get("amount") ?? "").trim();
  const amountFen = parseYuanToFen(amountRaw);
  if (amountFen === null || amountFen <= 0 || amountFen > ABSOLUTE_MAX_FEN) {
    return NextResponse.json({ error: "请输入有效的赞助金额" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const origin = await requestSiteUrl();

  const result = await createSponsorOrder({
    userId,
    amountFen,
    payType: String(form.get("payType") ?? "alipay"),
    message: typeof form.get("message") === "string" ? String(form.get("message")) : null,
    anonymous: form.get("anonymous") === "on" || form.get("anonymous") === "true",
    displayName: session?.user?.name ?? session?.user?.email ?? null,
    ipHash: hashIp(ip),
    origin,
  });

  if (!result.ok) {
    // 失败回 /fund 并带上原因（不把上游/内部细节暴露给用户）
    const back = new URL("/fund", origin);
    back.searchParams.set("pay_error", result.error);
    back.hash = "sponsor";
    return NextResponse.redirect(back, { status: 303 });
  }

  return NextResponse.redirect(result.payUrl, { status: 303 });
}

/**
 * GET 只用于回显当前可用的赞助档位与渠道（前台首屏已经是 RSC，
 * 这个入口留给需要客户端拉取的场景，例如支付结果页重试）。
 */
export async function GET() {
  return NextResponse.json(await getPublicPaymentConfig(), {
    headers: { "cache-control": "no-store" },
  });
}
