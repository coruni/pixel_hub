// 易支付（Epay，彩虹系规范）协议层 —— **纯服务端**。
//
// 分层的理由（payment-plan.md §7）：本文件只认「签名 + HTTP」，领域层（payment.ts）
// 只认「订单 + 状态机」。换支付通道时只动这一层，订单表与前台一行都不用改。
//
// ============================ 安全纪律（逐条可验收） ============================
//  1. 验签用 `timingSafeEqual` 做恒定时间比较，不用 `===`（防时序侧信道）。
//  2. 密钥**只在本文件被读取**，不写进任何日志、不 returned 给调用方、不进 URL 诊断输出。
//     上游 `api.php` 按设计要求 key 放在 query 里，所以打印 URL 前一律走 `redactUrl()`。
//  3. 空值参数不参与签名 —— 少了这条，「上游带了个空参数」就会让验签全挂。
//  4. 金额比对由调用方（payment.ts）负责；本文件只负责把 `money` 交给 `parseGatewayMoney`。
//
// 【联调前提】`notify_url` 必须公网可达。本地开发无法直接联调，需公网隧道或在
// Vercel 预览环境验证回调与 `success` 返回（写进验收说明）。
import { createHash, timingSafeEqual } from "crypto";
import type { PaymentConfig } from "@/lib/payment-config";

export type EpayParams = Record<string, string>;

export const EPAY_SIGN_TYPE = "MD5";

/** 参与签名的原始串：剔除 sign/sign_type → 去掉空值 → 按 key 升序 → `k=v&k=v` */
function signSource(params: EpayParams): string {
  return Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type")
    .filter((k) => {
      const v = params[k];
      return v !== undefined && v !== null && String(v) !== "";
    })
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

/** 签名 = md5(原始串 + 商户密钥)，小写十六进制 */
export function buildSign(params: EpayParams, key: string): string {
  return createHash("md5")
    .update(signSource(params) + key)
    .digest("hex")
    .toLowerCase();
}

/** 恒定时间比较（长度不同直接 false —— 长度本身不敏感） */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 验签。上游会把 sign 传成大写或带空格，统一规范化后再比 */
export function verifySign(params: EpayParams, key: string, sign: string | undefined): boolean {
  if (!sign) return false;
  const got = sign.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(got)) return false;
  return safeEqual(buildSign(params, key), got);
}

/** 打印/记录 URL 前先脱敏：抹掉 key 与 sign（他们出现在 query 里是上游规范要求，但不能进日志） */
export function redactUrl(url: string): string {
  return url
    .replace(/([?&](?:key|sign)=)[^&]*/gi, "$1***")
    .replace(/([?&]pid=)[^&]*/gi, "$1***");
}

function base(cfg: PaymentConfig): string {
  return cfg.epay.url.replace(/\/+$/, "");
}

/** 下单参数（不含 sign） */
export type CreateOrderArgs = {
  outTradeNo: string;
  /** alipay | wxpay */
  payType: string;
  name: string;
  /** 元字符串，两位小数（`12.30`）—— 上游按元收，**不要传分** */
  money: string;
  notifyUrl: string;
  returnUrl: string;
};

/**
 * 生成跳转到上游收银台的完整地址（GET submit.php）。
 * 用 302 跳转而不是自建 POST 表单：少一个中转页，也少一次「表单被改」的可能。
 */
export function submitUrl(cfg: PaymentConfig, args: CreateOrderArgs): string {
  const params: EpayParams = {
    pid: cfg.epay.pid,
    type: args.payType,
    out_trade_no: args.outTradeNo,
    notify_url: args.notifyUrl,
    return_url: args.returnUrl,
    name: args.name,
    money: args.money,
    sign_type: EPAY_SIGN_TYPE,
  };
  const sign = buildSign(params, cfg.epay.key);
  const query = Object.entries({ ...params, sign })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${base(cfg)}/submit.php?${query}`;
}

export type RemoteOrder = {
  ok: boolean;
  /** 上游认定的支付状态 */
  paid: boolean;
  moneyFen: number | null;
  tradeNo: string | null;
  payType: string | null;
  error?: string;
};

/** 上游 JSON 取值容错：不同实现的字段名不完全一致，只认我们真正需要的几个 */
function readRemote(raw: unknown): RemoteOrder {
  if (!raw || typeof raw !== "object") {
    return { ok: false, paid: false, moneyFen: null, tradeNo: null, payType: null, error: "上游返回非 JSON" };
  }
  const o = raw as Record<string, unknown>;
  const code = String(o.code ?? o.status ?? "");
  // code=1 为成功（彩虹系）；部分实现用 status=1
  const ok = code === "1" || code === "true";
  const tradeStatus = String(o.trade_status ?? o.status ?? "").toUpperCase();
  const paid = tradeStatus === "TRADE_SUCCESS" || tradeStatus === "SUCCESS" || o.paid === true;
  const moneyRaw = o.money ?? o.price ?? o.amount;
  const moneyFen =
    typeof moneyRaw === "string" || typeof moneyRaw === "number"
      ? parseGatewayMoneyLocal(String(moneyRaw))
      : null;
  return {
    ok,
    paid,
    moneyFen,
    tradeNo: o.trade_no ? String(o.trade_no) : null,
    payType: o.type ? String(o.type) : null,
    ...(ok ? {} : { error: String(o.msg ?? o.message ?? "上游返回失败") }),
  };
}

/** 与 money.ts 的 parseYuanToFen 同规则；本地实现避免协议层依赖展示层 */
function parseGatewayMoneyLocal(input: string): number | null {
  const m = /^\+?(\d{1,12})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const fen = Number(m[1] ?? "0") * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(fen) ? fen : null;
}

async function callApi(cfg: PaymentConfig, query: Record<string, string>): Promise<RemoteOrder> {
  const url = `${base(cfg)}/api.php?${new URLSearchParams({
    ...query,
    pid: cfg.epay.pid,
    key: cfg.epay.key,
  }).toString()}`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, paid: false, moneyFen: null, tradeNo: null, payType: null, error: "上游返回无法解析" };
    }
    return readRemote(json);
  } catch (e) {
    // 绝不打印 url（含明文 key）
    console.error("[epay] 调用上游失败", (e as Error)?.name ?? "error");
    return { ok: false, paid: false, moneyFen: null, tradeNo: null, payType: null, error: "上游不可达" };
  }
}

/** 主动查单（回调可能丢失：/pay/result 的「刷新状态」与服务端补偿都走这里） */
export function queryOrder(cfg: PaymentConfig, outTradeNo: string): Promise<RemoteOrder> {
  return callApi(cfg, { act: "order", out_trade_no: outTradeNo });
}

/** 通道自检（/admin/payment 的「连通性自检」）：验证 pid/key 有效且网关可达 */
export function checkChannel(cfg: PaymentConfig): Promise<RemoteOrder> {
  return callApi(cfg, { act: "query" });
}

/** 退款（全额/部分）。返回是否受理；真正的资金结果以查单为准 */
export async function refund(
  cfg: PaymentConfig,
  args: { outTradeNo: string; money: string },
): Promise<{ ok: boolean; error?: string }> {
  const res = await callApi(cfg, {
    act: "refund",
    out_trade_no: args.outTradeNo,
    money: args.money,
  });
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? "退款被上游拒绝" };
}
