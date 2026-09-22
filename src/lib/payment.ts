// 支付订单领域层 —— 只认「订单 + 状态机 + 台账」，不认签名细节（那是 epay.ts 的事）。
//
// ============================ 状态机（单向，可幂等重放） ============================
//   PENDING ──(回调/查单确认 PAID)──▶ PAID ──(退款)──▶ REFUNDED
//      └────(超时/放弃)────▶ CLOSED
//
// 【幂等】易支付会重复推送同一条回调。`updateMany({ where: { outTradeNo, status: "PENDING" } })`
// 让「只有第一次能改状态」，改成功才写收入台账 —— 连推 5 次，`LedgerEntry(INCOME_SPONSOR)` 只有一条。
// 这条是用 `updateMany` 的条件而不是「先读再判断」实现的：先读后写在并发回调下会双双通过。
//
// 【金额必须比对】回调 `money` 解析成分后必须等于订单 `amountFen`，不等直接拒。
// 用字符串解析（`parseGatewayMoney`），**不用 `parseFloat * 100`** —— 差一分钱就是
// 「付 1 元拿到 10 元的东西」。
//
// 【密钥不出服务端】本文件只把 key 交给 epay.ts；落库的 `notifyRaw` 已剔除 key/sign。
import { Prisma } from "@prisma/client";
import type { OrderStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { getPaymentConfig } from "@/lib/payment-settings";
import { epayReady, validateSponsorAmount } from "@/lib/payment-config";
import { queryOrder, refund as epayRefund, submitUrl, verifySign } from "@/lib/epay";
import { fenToYuanText, parseGatewayMoney } from "@/lib/money";
import { monthKey } from "@/lib/format";
import { recordLedger } from "@/lib/ledger";

export type CreateOrderInput = {
  /** 付款人；未登录赞助为 null */
  userId: string | null;
  amountFen: number;
  payType: string;
  message?: string | null;
  anonymous: boolean;
  /** 鸣谢墙展示名快照（登录用户取用户名，游客留空） */
  displayName?: string | null;
  ipHash: string;
  /** 站点当前请求地址（回调/跳转必须指向用户可达域名） */
  origin: string;
};

export type CreateOrderResult =
  | { ok: true; orderId: string; outTradeNo: string; payUrl: string }
  | { ok: false; error: string };

export async function createSponsorOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const cfg = await getPaymentConfig();
  if (!epayReady(cfg)) return { ok: false, error: "赞助通道尚未配置完成，请稍后再试" };

  const bad = validateSponsorAmount(cfg, input.amountFen);
  if (bad) return { ok: false, error: bad };

  const payType = input.payType === "wxpay" ? "wxpay" : "alipay";
  if (payType === "alipay" && !cfg.epay.alipay) return { ok: false, error: "支付宝渠道当前未开放" };
  if (payType === "wxpay" && !cfg.epay.wxpay) return { ok: false, error: "微信支付渠道当前未开放" };
  if (!input.userId && !cfg.sponsor.allowGuest) return { ok: false, error: "请先登录后再赞助" };
  if (input.anonymous && !cfg.sponsor.allowAnonymous) {
    return { ok: false, error: "当前未开放匿名赞助" };
  }

  const money = fenToYuanText(input.amountFen);
  const message = cfg.sponsor.messageMax > 0
    ? input.message?.trim().slice(0, cfg.sponsor.messageMax) || null
    : null;
  const anonymous = input.anonymous && cfg.sponsor.allowAnonymous;

  const order = await prisma.paymentOrder.create({
    data: {
      // out_trade_no 用随机串（不可预测）—— 绝不用自增 id 或用户 id 拼接，否则可枚举、可伪造回调
      outTradeNo: randomUUID().replace(/-/g, ""),
      kind: "SPONSOR",
      userId: input.userId,
      amountFen: input.amountFen,
      subject: `${cfg.order.subjectPrefix}（${money} 元）`,
      periodKey: monthKey(new Date()),
      message,
      anonymous,
      displayName: anonymous ? null : (input.displayName ?? null),
      ipHash: input.ipHash,
    },
    select: { id: true, outTradeNo: true },
  });

  const payUrl = submitUrl(cfg, {
    outTradeNo: order.outTradeNo,
    payType,
    name: `${cfg.order.subjectPrefix}（${money} 元）`,
    money,
    notifyUrl: `${input.origin}/api/pay/notify`,
    returnUrl: `${input.origin}/pay/result?out_trade_no=${order.outTradeNo}`,
  });

  return { ok: true, orderId: order.id, outTradeNo: order.outTradeNo, payUrl };
}

/** 落库前剔除机密字段：回调原文仅作审计，不得残留 key/sign */
function sanitizeNotify(query: Record<string, string>): string {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (k === "key" || k === "sign" || k === "sign_type") continue;
    clean[k] = String(v).slice(0, 200);
  }
  return JSON.stringify(clean).slice(0, 2000);
}

export type NotifyResult = { ok: boolean; orderId?: string; reason?: string };

/**
 * 处理上游回调。返回 `ok: false` 时**也要按上游要求回 success 之外的内容**
 * （路由层负责：只有 ok 才回纯文本 `success`）。
 */
export async function handleNotify(query: Record<string, string>): Promise<NotifyResult> {
  const cfg = await getPaymentConfig();
  if (!epayReady(cfg)) return { ok: false, reason: "通道未配置" };

  // 1. 验签是前提，过了才谈发货
  if (!verifySign(query, cfg.epay.key, query.sign)) {
    console.error("[payment] 回调验签失败 out_trade_no=", query.out_trade_no ?? "?");
    return { ok: false, reason: "验签失败" };
  }

  const outTradeNo = query.out_trade_no;
  if (!outTradeNo) return { ok: false, reason: "缺少订单号" };

  const order = await prisma.paymentOrder.findUnique({
    where: { outTradeNo },
    select: { id: true, amountFen: true, status: true },
  });
  if (!order) return { ok: false, reason: "订单不存在" };

  // 已支付：直接认作成功（上游重复推送），**不二次发货、不二次记账**
  if (order.status === "PAID" || order.status === "REFUNDED") {
    return { ok: true, orderId: order.id };
  }

  // 2. 只有 TRADE_SUCCESS 发货，其余原样返回（不认作成功，让上游继续重试或放弃）
  if (String(query.trade_status ?? "").toUpperCase() !== "TRADE_SUCCESS") {
    return { ok: false, reason: `非成功状态：${query.trade_status ?? "?"}` };
  }

  // 3. 金额必须比对（字符串解析，无浮点）
  const paidFen = parseGatewayMoney(String(query.money ?? ""));
  if (paidFen === null) return { ok: false, reason: "金额无法解析" };
  if (paidFen !== order.amountFen) {
    console.error(`[payment] 金额不一致 order=${order.amountFen} paid=${paidFen} no=${outTradeNo}`);
    return { ok: false, reason: "金额不一致" };
  }

  const done = await markPaid(outTradeNo, {
    tradeNo: query.trade_no ?? null,
    payType: query.type ?? null,
    moneyFen: paidFen,
    notifyRaw: sanitizeNotify(query),
  });
  return done ? { ok: true, orderId: order.id } : { ok: false, reason: "状态流转失败" };
}

/**
 * 把订单标记为已支付，并写**恰好一条**收入台账。
 * 幂等：状态条件更新只有第一次 count===1；台账再靠 `@@unique([kind, refId])` 兜一层。
 */
export async function markPaid(
  outTradeNo: string,
  info: { tradeNo: string | null; payType: string | null; moneyFen: number; notifyRaw?: string | null },
): Promise<boolean> {
  const order = await prisma.paymentOrder.findUnique({
    where: { outTradeNo },
    select: { id: true, amountFen: true, periodKey: true },
  });
  if (!order) return false;

  try {
    return await prisma.$transaction(async (tx) => {
      const upd = await tx.paymentOrder.updateMany({
        where: { outTradeNo, status: "PENDING" }, // ← 单向闸门：只有第一次能改
        data: {
          status: "PAID",
          paidAt: new Date(),
          epayTradeNo: info.tradeNo,
          payType: info.payType,
          ...(info.notifyRaw ? { notifyRaw: info.notifyRaw } : {}),
        },
      });
      if (upd.count === 0) return true; // 已被并发回调处理过：视作成功（不重复记账）

      await recordLedger(tx, {
        kind: "INCOME_SPONSOR",
        amountFen: order.amountFen,
        periodKey: order.periodKey ?? monthKey(new Date()),
        refType: "PAYMENT_ORDER",
        refId: order.id,
        note: `赞助订单 ${outTradeNo}`,
      });
      return true;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return true;
    console.error("[payment] 标记已支付失败", e);
    return false;
  }
}

export type SyncResult = { ok: boolean; paid: boolean; error?: string };

/**
 * 主动查单兜底（回调可能丢失）。`/pay/result` 的「刷新状态」与后台对账都走这里。
 * 不依赖常驻 cron —— 只在用户/管理员主动触发时发一次请求。
 */
export async function syncOrder(outTradeNo: string): Promise<SyncResult> {
  const cfg = await getPaymentConfig();
  if (!epayReady(cfg)) return { ok: false, paid: false, error: "通道未配置" };

  const order = await prisma.paymentOrder.findUnique({
    where: { outTradeNo },
    select: { status: true, amountFen: true },
  });
  if (!order) return { ok: false, paid: false, error: "订单不存在" };
  if (order.status === "PAID" || order.status === "REFUNDED") return { ok: true, paid: true };

  const remote = await queryOrder(cfg, outTradeNo);
  if (!remote.ok || !remote.paid) {
    return { ok: remote.ok, paid: false, error: remote.error };
  }
  // 上游说已付，金额以**我方订单**为准再比一次（防止上游配置错误导致金额不符）
  if (remote.moneyFen !== null && remote.moneyFen !== order.amountFen) {
    console.error(`[payment] 查单金额不一致 order=${order.amountFen} remote=${remote.moneyFen}`);
    return { ok: false, paid: false, error: "上游金额与订单不一致，请人工核对" };
  }
  const done = await markPaid(outTradeNo, {
    tradeNo: remote.tradeNo,
    payType: remote.payType,
    moneyFen: order.amountFen,
  });
  return { ok: done, paid: done };
}

/** 后台发起退款：登记退款额 + 写冲减台账（真正的资金结果以查单为准） */
export async function refundOrder(
  orderId: string,
  amountFen: number,
  adminId: string,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getPaymentConfig();
  if (!epayReady(cfg)) return { ok: false, error: "通道未配置" };

  const order = await prisma.paymentOrder.findUnique({
    where: { id: orderId },
    select: { id: true, outTradeNo: true, amountFen: true, refundedFen: true, status: true, periodKey: true },
  });
  if (!order) return { ok: false, error: "订单不存在" };
  if (order.status !== "PAID") return { ok: false, error: "只有已支付的订单可以退款" };
  if (amountFen <= 0 || amountFen > order.amountFen - order.refundedFen) {
    return { ok: false, error: "退款金额超出可退余额" };
  }

  const res = await epayRefund(cfg, { outTradeNo: order.outTradeNo, money: fenToYuanText(amountFen) });
  if (!res.ok) return { ok: false, error: res.error ?? "退款失败" };

  const nextRefunded = order.refundedFen + amountFen;
  await prisma.$transaction(async (tx) => {
    await tx.paymentOrder.update({
      where: { id: order.id },
      data: {
        refundedFen: nextRefunded,
        status: nextRefunded >= order.amountFen ? "REFUNDED" : "PAID",
      },
    });
    await recordLedger(tx, {
      kind: "REFUND_SPONSOR",
      amountFen,
      periodKey: order.periodKey ?? monthKey(new Date()),
      refType: "PAYMENT_ORDER",
      // 幂等键带累计退款额：同一订单可多次部分退款，但每次只记一条
      refId: `${order.id}#${nextRefunded}`,
      note: `赞助退款 ${order.outTradeNo}`,
      createdBy: adminId,
    });
  });
  return { ok: true };
}

// ---------- 读侧 ----------

export type OrderRow = {
  id: string;
  outTradeNo: string;
  amountFen: number;
  status: OrderStatus;
  payType: string | null;
  epayTradeNo: string | null;
  paidAt: Date | null;
  refundedFen: number;
  message: string | null;
  periodKey: string | null;
  createdAt: Date;
  buyer: string | null;
};

export async function listOrders(input: {
  status?: OrderStatus;
  take: number;
  cursor?: string | null;
}): Promise<OrderRow[]> {
  const rows = await prisma.paymentOrder.findMany({
    where: { kind: "SPONSOR", ...(input.status ? { status: input.status } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.take,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { user: { select: { username: true, name: true } } },
  });
  return rows.map((o) => ({
    id: o.id,
    outTradeNo: o.outTradeNo,
    amountFen: o.amountFen,
    status: o.status,
    payType: o.payType,
    epayTradeNo: o.epayTradeNo,
    paidAt: o.paidAt,
    refundedFen: o.refundedFen,
    message: o.message,
    periodKey: o.periodKey,
    createdAt: o.createdAt,
    buyer: o.anonymous ? null : (o.user?.name || o.user?.username || o.displayName || null),
  }));
}

export async function getOrderById(id: string) {
  return prisma.paymentOrder.findUnique({
    where: { id },
    include: { user: { select: { username: true, name: true } } },
  });
}

/**
 * 鸣谢墙：已支付赞助按月分组。
 * **匿名在对外视图一律匿名** —— 这里直接把 displayName 抹成 null，让上层的展示文案统一
 * 落到「一位路过的朋友」，而不是靠每个组件自己记得判 anonymous。
 */
export type ThanksRow = {
  id: string;
  displayName: string | null;
  anonymous: boolean;
  amountFen: number;
  message: string | null;
  paidAt: Date | null;
  periodKey: string | null;
};

export async function thanksWall(take = 200): Promise<ThanksRow[]> {
  const rows = await prisma.paymentOrder.findMany({
    where: { kind: "SPONSOR", status: { in: ["PAID", "REFUNDED"] }, paidAt: { not: null } },
    orderBy: { paidAt: "desc" },
    take,
    include: { user: { select: { username: true, name: true } } },
  });
  return rows.map((o) => ({
    id: o.id,
    displayName: o.anonymous ? null : (o.user?.name || o.user?.username || o.displayName || null),
    anonymous: o.anonymous,
    amountFen: o.amountFen,
    message: o.message,
    paidAt: o.paidAt,
    periodKey: o.periodKey,
  }));
}

/** 赞助累计：笔数 + 金额（已扣退款） */
export async function sponsorTotals(): Promise<{ count: number; amountFen: number }> {
  const agg = await prisma.paymentOrder.aggregate({
    where: { kind: "SPONSOR", status: { in: ["PAID", "REFUNDED"] } },
    _count: { _all: true },
    _sum: { amountFen: true, refundedFen: true },
  });
  return {
    count: agg._count._all,
    amountFen: (agg._sum.amountFen ?? 0) - (agg._sum.refundedFen ?? 0),
  };
}

/** 支付通道是否可用（前台用；不暴露任何密钥字段） */
export async function sponsorEnabled(): Promise<boolean> {
  const cfg = await getPaymentConfig();
  return epayReady(cfg) && cfg.sponsor.enabled;
}
