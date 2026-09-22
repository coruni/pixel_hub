import { NextRequest } from "next/server";
import { handleNotify } from "@/lib/payment";

// 易支付回调端点。
//
// 【必回纯文本 success】不是 JSON、不是 200 空响应 —— 上游只认这个字面量，
// 否则会持续重试（并在商户后台记「回调失败」）。
//
// 【验签 → 金额比对 → 状态机】三道全在 payment.handleNotify 里，
// 本文件只负责把 GET / POST 两种推送形式的参数拼平、把结果翻成 text/plain。
//
// 不鉴权是**故意**的：上游没有我们的会话。安全性靠签名（含密钥）+ 金额比对 + 金额上限。
export const dynamic = "force-dynamic";

function fail(reason: string): Response {
  // 不回 success（让上游继续重试），但也不回 500（避免被上游判成网关故障刷爆日志）
  return new Response(`fail: ${reason}`, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

async function collect(req: NextRequest, fromBody: boolean): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (fromBody) {
    const form = await req.formData().catch(() => null);
    if (form) {
      for (const [k, v] of form.entries()) out[k] = typeof v === "string" ? v : "";
      return out;
    }
    const text = await req.text().catch(() => "");
    new URLSearchParams(text).forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  req.nextUrl.searchParams.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export async function POST(req: NextRequest) {
  const query = await collect(req, true);
  const res = await handleNotify(query);
  if (!res.ok) return fail(res.reason ?? "处理失败");
  return new Response("success", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(req: NextRequest) {
  const query = await collect(req, false);
  const res = await handleNotify(query);
  if (!res.ok) return fail(res.reason ?? "处理失败");
  return new Response("success", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
