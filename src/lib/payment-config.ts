// 支付与赞助配置 —— 纯数据/校验层（不依赖 server，可被前后端与脚本共用）。
// 文档存于 SiteSetting["payment"]（JSON 文本），带 version 乐观锁（读写见 payment-settings.ts）。
//
// 【密钥纪律】`epay.key` 是本文件里唯一的机密字段。它只允许被服务端读取，
// 且**绝不允许通过 `publicPaymentConfig()` 出口**（那个函数是给前台与 client 组件用的）。
// 全站验收项「密钥不泄露」= 任何 client component / 页面输出 / 日志里都不出现 epayKey。
//
// 命名纪律：本文件只管「怎么收钱」。向创作者发钱（PIX 结算、提现）在 points-config.ts。
import { z } from "zod";

/** SiteSetting key：支付配置文档 */
export const PAYMENT_KEY = "payment";

const intRange = (min: number, max: number) => z.number().int().min(min).max(max);

// ---------- 易支付（Epay）通道 ----------
// 易支付是「聚合网关」：我们只跟它签一次约，它再分派到支付宝/微信。
// 协议见 src/lib/epay.ts（签名 = md5(按 key 升序拼接 + 商户密钥)）。

const epaySchema = z.object({
  /** 通道总开关。关掉后前台下单入口隐藏、下单 API 直接拒绝（已有订单不受影响） */
  enabled: z.boolean().default(false),
  /** 网关基址，如 https://pay.example.com（不带 /submit.php 等路径） */
  url: z.string().trim().max(300).default(""),
  /** 商户 ID */
  pid: z.string().trim().max(64).default(""),
  /** 商户密钥 —— **机密**，仅服务端可见 */
  key: z.string().trim().max(200).default(""),
  /** 渠道开关（易支付按 `type` 分派），用于前台只列出可用渠道 */
  alipay: z.boolean().default(true),
  wxpay: z.boolean().default(true),
});

// ---------- 站点赞助 ----------
// 文案纪律（公益站调性）：只讲「赞助 / 支持」，禁止「VIP / 会员 / 解锁 / 特权」。
// 自检：把「付费」换成「捐赠」，这句话还成立吗？

const sponsorSchema = z.object({
  /** 赞助入口开关（关掉后 /fund 不出现区块 ④，页面不留空块） */
  enabled: z.boolean().default(true),
  /** 预设档位（分）。后台可改；前台按档位渲染按钮，另附自定义输入 */
  tiers: z.array(intRange(100, 100000000)).min(1).max(8).default([500, 1000, 3000, 5000]),
  /** 单笔下限（分），默认 1 元 */
  minFen: intRange(100, 100000000).default(100),
  /** 单笔上限（分），默认 1000 元 */
  maxFen: intRange(100, 100000000).default(100000),
  /** 是否允许匿名（匿名在对外视图一律显示为匿名，且不记展示名） */
  allowAnonymous: z.boolean().default(true),
  /** 是否允许未登录赞助（赞助是「支持」不是「权益」，没理由要求先登录） */
  allowGuest: z.boolean().default(true),
  /** 留言最大字数 */
  messageMax: intRange(0, 200).default(60),
});

/** 订单参数 */
const orderSchema = z.object({
  /** 订单有效期（分钟）：超时视为关闭，前台显示「已超时」，后台可批量 CLOSED */
  ttlMinutes: intRange(5, 1440).default(30),
  /** 提交给易支付的商品名前缀（便于在商户后台对账时一眼认出本站订单） */
  subjectPrefix: z.string().trim().max(40).default("支持 Pixel Hub"),
  /** 创建订单的频率限制（次 / 分钟 / IP），防刷单探测 */
  ratePerMinute: intRange(1, 120).default(10),
});

export const paymentConfigSchema = z.object({
  epay: epaySchema,
  sponsor: sponsorSchema,
  order: orderSchema,
});

export type PaymentConfig = z.infer<typeof paymentConfigSchema>;

/** 需要「缺失即补空对象」的字段组 —— 组内每个叶子都有 .default()，补 {} 即可整体回落默认 */
const GROUP_KEYS = ["epay", "sponsor", "order"] as const;

function withGroupDefaults(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const k of GROUP_KEYS) {
    const v = out[k];
    if (v === null || typeof v !== "object" || Array.isArray(v)) out[k] = {};
  }
  return out;
}

export function parsePaymentConfig(raw: unknown): PaymentConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const r = paymentConfigSchema.safeParse(withGroupDefaults(o));
  if (r.success) return structuredClone(r.data);
  return structuredClone(paymentConfigSchema.parse(withGroupDefaults({})));
}

export function serializePaymentConfig(c: PaymentConfig): string {
  return JSON.stringify(c);
}

/** 保存前校验（整份替换，WYSIWYG —— 与 safeIncentive 同语义） */
export function safePaymentConfig(
  value: unknown,
): { ok: true; data: PaymentConfig } | { ok: false; error: string } {
  const o = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const r = paymentConfigSchema.safeParse(withGroupDefaults(o));
  if (r.success) return { ok: true, data: structuredClone(r.data) };
  const issue = r.error.issues[0];
  const path = issue?.path.join(".");
  return { ok: false, error: `${path ? `${path}：` : ""}${issue?.message ?? "配置不合法"}` };
}

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = parsePaymentConfig(null);

/**
 * 后台表单提交「**密钥保持不变**」的哨兵值。
 *
 * 为什么需要它：密钥永不出服务端，所以后台页面上那个密钥输入框一开始是空的 ——
 * 如果空值被当作「清空密钥」提交，任何一次「只改个档位」的保存都会把支付通道打瘫。
 * 未勾选「更换密钥」时表单提交本哨兵，服务端在 zod 校验前换回库里那份。
 */
export const KEEP_SECRET = "__KEEP_UNCHANGED__";

/**
 * 对外投影 —— **前台与任何 client 组件只能拿这个**。
 * 结构上就不含 `pid` / `key` / `url`，不是靠调用方自觉过滤：
 * 少了这一层，「密钥不出服务端」就只是一句注释，而不是一个编译器能守住的约束。
 */
export type PublicPaymentConfig = {
  /** 通道是否可用（enabled 且有最小必要配置） */
  ready: boolean;
  channels: { alipay: boolean; wxpay: boolean };
  sponsor: {
    enabled: boolean;
    tiers: number[];
    minFen: number;
    maxFen: number;
    allowAnonymous: boolean;
    allowGuest: boolean;
    messageMax: number;
  };
};

export function publicPaymentConfig(c: PaymentConfig): PublicPaymentConfig {
  return {
    ready: epayReady(c),
    channels: { alipay: c.epay.alipay, wxpay: c.epay.wxpay },
    sponsor: { ...c.sponsor, tiers: [...c.sponsor.tiers] },
  };
}

/** 通道是否配置齐全（开关 + 基址 + 商户号 + 密钥） */
export function epayReady(c: PaymentConfig): boolean {
  return c.epay.enabled && !!c.epay.url && !!c.epay.pid && !!c.epay.key;
}

/**
 * 创建订单时的金额/留言闸门（前后台共用同一套判定，避免前台放行、服务端才拒）。
 * 返回 null = 合法。
 */
export function validateSponsorAmount(
  c: PaymentConfig,
  amountFen: number,
): string | null {
  if (!c.sponsor.enabled) return "赞助入口当前未开放";
  if (!Number.isInteger(amountFen)) return "金额必须是整数（分）";
  if (amountFen < c.sponsor.minFen) return `单笔不少于 ${(c.sponsor.minFen / 100).toFixed(2)} 元`;
  if (amountFen > c.sponsor.maxFen) return `单笔不超过 ${(c.sponsor.maxFen / 100).toFixed(2)} 元`;
  return null;
}

// ---------- 台账科目 ----------
// direction 由本表派生（唯一写入口 ledger.ts 填库），库里同步存一份供 SQL 聚合。
// 科目文案给后台 /admin/finance 与前台 /fund 共用，**不允许各处再写一份**。

export const LEDGER_KIND_META = {
  COST_SERVER: { label: "服务器", direction: "OUT", group: "cost" },
  COST_STORAGE: { label: "存储 / 流量", direction: "OUT", group: "cost" },
  COST_DOMAIN: { label: "域名 / 证书", direction: "OUT", group: "cost" },
  COST_OTHER: { label: "其他运营成本", direction: "OUT", group: "cost" },
  INCOME_SPONSOR: { label: "站点赞助", direction: "IN", group: "income" },
  INCOME_AD: { label: "联盟广告", direction: "IN", group: "income" },
  INCOME_OTHER: { label: "其他收入", direction: "IN", group: "income" },
  WITHDRAWAL_PAID: { label: "创作者提现打款", direction: "OUT", group: "payout" },
  REFUND_SPONSOR: { label: "赞助退款", direction: "OUT", group: "refund" },
} as const satisfies Record<string, { label: string; direction: "IN" | "OUT"; group: string }>;

export type LedgerKind = keyof typeof LEDGER_KIND_META;

export const LEDGER_KINDS = Object.keys(LEDGER_KIND_META) as LedgerKind[];

export function ledgerKindLabel(k: string): string {
  return (LEDGER_KIND_META as Record<string, { label: string } | undefined>)[k]?.label ?? k;
}

export function ledgerKindDirection(k: LedgerKind): "IN" | "OUT" {
  return LEDGER_KIND_META[k].direction;
}

export function isIncomeKind(k: string): boolean {
  return LEDGER_KIND_META[k as LedgerKind]?.direction === "IN";
}

/** 前端表单可选科目（按分组），避免各处手写 list */
export const COST_KINDS = LEDGER_KINDS.filter((k) => LEDGER_KIND_META[k].group === "cost");
export const INCOME_KINDS = LEDGER_KINDS.filter((k) => LEDGER_KIND_META[k].group === "income");
