"use server";

// 支付后台 action：通道配置保存 / 恢复默认 / 连通性自检 / 成本录入 / 订单补单。
//
// 【密钥纪律】保存走整份替换（与激励配置同范式），但**返回值只带 ok/error**，
// 绝不回显配置里含 key 的字段；连通性自检也只回报「通/不通 + 原因」，不回报请求 URL。
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { adminOnly, audit } from "@/lib/actions/_guards";
import { DEFAULT_PAYMENT_CONFIG, KEEP_SECRET, safePaymentConfig, type LedgerKind } from "@/lib/payment-config";
import { readPaymentDoc, writePaymentDoc, getPaymentConfig } from "@/lib/payment-settings";
import { checkChannel } from "@/lib/epay";
import { recordLedgerStandalone } from "@/lib/ledger";
import { markPaid, syncOrder } from "@/lib/payment";
import { isPeriodKey } from "@/lib/settle-allocate";
import { parseYuanToFen } from "@/lib/money";
import type { ActionResult } from "@/lib/hooks";

const CONFLICT: ActionResult = { ok: false, error: "配置已被其他人修改，请刷新页面后重试" };

function revalidatePayment() {
  revalidatePath("/admin/payment");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/settlement");
  revalidatePath("/admin/withdrawals");
  revalidatePath("/fund");
}

/** 保存整份支付/赞助配置（zod 为唯一权威校验） */
export async function savePaymentConfigAction(raw: unknown): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  // 【密钥哨兵】后台表单里没有密钥值（它从不下发到浏览器），未勾选「更换密钥」时提交
  // KEEP_SECRET。在 zod 校验**之前**把它换成库里那份 —— 顺序不能反，
  // 否则哨兵会被当成真密钥存进去，通道直接失效。
  const input = { ...(raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) };
  const epay = { ...(input.epay && typeof input.epay === "object" ? (input.epay as Record<string, unknown>) : {}) };
  const doc = await readPaymentDoc();
  if (epay.key === KEEP_SECRET) epay.key = doc.config.epay.key;
  input.epay = epay;

  const parsed = safePaymentConfig(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  doc.config = parsed.data;
  if (!(await writePaymentDoc(doc))) return CONFLICT;
  await audit(admin.id, "EDIT_PAYMENT", "PAYMENT", undefined, "保存支付与赞助配置");
  revalidatePayment();
  return { ok: true };
}

/** 恢复默认（含清空密钥 —— 换/撤销商户时用） */
export async function resetPaymentConfigAction(): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const doc = await readPaymentDoc();
  doc.config = structuredClone(DEFAULT_PAYMENT_CONFIG);
  if (!(await writePaymentDoc(doc))) return CONFLICT;
  await audit(admin.id, "RESET_PAYMENT", "PAYMENT");
  revalidatePayment();
  return { ok: true };
}

/** 通道连通性自检：调上游 `act=query` 验 pid/key 与可达性 */
export async function checkEpayChannelAction(): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const cfg = await getPaymentConfig();
  if (!cfg.epay.url || !cfg.epay.pid || !cfg.epay.key) {
    return { ok: false, error: "请先填写网关地址、商户 ID 与密钥" };
  }
  const res = await checkChannel(cfg);
  await audit(admin.id, "CHECK_EPAY", "PAYMENT", undefined, res.ok ? "通" : (res.error ?? "不通"));
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? "网关校验失败" };
}

/** 录一笔成本 / 其他收入（手工录入项 refId 为空，可多次录入） */
export async function addLedgerAction(input: {
  kind: string;
  amountYuan: string;
  periodKey: string;
  note?: string;
}): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (!isPeriodKey(input.periodKey)) return { ok: false, error: "归属期格式应为 YYYY-MM" };

  const amountFen = parseYuanToFen(input.amountYuan);
  if (amountFen === null || amountFen <= 0) return { ok: false, error: "金额不合法（最多两位小数）" };

  const ok = await recordLedgerStandalone({
    kind: input.kind as LedgerKind,
    amountFen,
    periodKey: input.periodKey,
    refType: "MANUAL",
    refId: null,
    note: input.note?.trim().slice(0, 200) || null,
    createdBy: admin.id,
  });
  if (!ok) return { ok: false, error: "科目不合法或记账失败" };

  await audit(admin.id, "ADD_LEDGER", "LEDGER", undefined, `${input.kind} ${amountFen}分`);
  revalidatePayment();
  return { ok: true };
}

/**
 * 手工补单：把某笔订单直接置为已支付（上游到账但回调丢失时用）。
 * 必须**带备注**并写 AuditLog —— 这是唯一一条「不经验签就入账」的通道，
 * 所以它必须以「人有明确理由」为前提，而不是一键操作。
 */
export async function manualSettleOrderAction(input: {
  outTradeNo: string;
  note: string;
}): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const note = input.note.trim();
  if (note.length < 4) return { ok: false, error: "请填写补单理由（至少 4 个字）" };

  const res = await syncOrder(input.outTradeNo);
  if (!res.ok && !res.paid) {
    // 上游查不到（回调丢失 + 上游接口不通）时就只能靠人工判断。金额以**订单表**为准 ——
    // 补单不允许改金额，否则「补单」就成了「想给谁多少钱就给多少」的通道。
    const order = await prisma.paymentOrder.findUnique({
      where: { outTradeNo: input.outTradeNo },
      select: { id: true },
    });
    if (!order) return { ok: false, error: "订单不存在" };
    const done = await markPaid(input.outTradeNo, { tradeNo: null, payType: null, moneyFen: 0 });
    if (!done) return { ok: false, error: "补单失败" };
  }

  await audit(admin.id, "MANUAL_SETTLE_ORDER", "PAYMENT_ORDER", input.outTradeNo, note);
  revalidatePayment();
  return { ok: true };
}
