"use server";

// 结算后台 action：收入录入 / 冲正、生成预览、确认锁定、重置草稿、标记已发放。
//
// 【为什么收入录入要写死提示】偿付水位的现金口径是「**已实际到账**的钱」。
// 录了还没到账的收入，等于把水位公式变成一个假的数字，最终会在提现时炸掉（提不出钱）。
// 所以入参校验里带一句不可绕过的提示文案，不只是 UI 上的装饰。
import { revalidatePath } from "next/cache";
import { adminOnly, audit } from "@/lib/actions/_guards";
import { parseYuanToFen } from "@/lib/money";
import { isPeriodKey } from "@/lib/settle-allocate";
import {
  addRevenue,
  confirmPeriod,
  deleteRevenue,
  resetDraftPeriod,
} from "@/lib/settle";
import { prisma } from "@/lib/db/prisma";
import type { ActionResult } from "@/lib/hooks";

function revalidateSettlement() {
  revalidatePath("/admin/settlement");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/withdrawals");
  revalidatePath("/creators");
  revalidatePath("/fund");
}

/** 收入录入（仅在钱已实际到账后录入；支持补录） */
export async function addRevenueAction(input: {
  periodKey: string;
  source: string;
  /** 元字符串，由表单原样提交（服务端做严格解析） */
  amountYuan: string;
  /** YYYY-MM-DD */
  receivedAt: string;
  note?: string;
}): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  if (!isPeriodKey(input.periodKey)) return { ok: false, error: "归属期格式应为 YYYY-MM" };
  const amountFen = parseYuanToFen(input.amountYuan);
  if (amountFen === null || amountFen <= 0) return { ok: false, error: "金额不合法（最多两位小数）" };

  const receivedAt = new Date(`${input.receivedAt}T12:00:00`);
  if (Number.isNaN(receivedAt.getTime())) return { ok: false, error: "到账日期不合法" };

  const source = input.source.trim().slice(0, 40) || "其他收入";

  await addRevenue({
    periodKey: input.periodKey,
    source,
    amountFen,
    receivedAt,
    note: input.note?.trim().slice(0, 200) || null,
    createdBy: admin.id,
  });
  await audit(admin.id, "ADD_REVENUE", "REVENUE", undefined, `${input.periodKey} ${source} ${amountFen}分`);
  revalidateSettlement();
  return { ok: true };
}

/** 冲正：删掉一条收入录入。仅在结算期还是草稿时允许 —— 已公示的数字不可事后修改 */
export async function deleteRevenueAction(id: string): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const res = await deleteRevenue(id);
  if (!res.ok) return { ok: false, error: res.error ?? "删除失败" };
  await audit(admin.id, "DELETE_REVENUE", "REVENUE", id);
  revalidateSettlement();
  return { ok: true };
}

/** 确认结算期：落快照 → 逐人入账 PIX → 翻状态（可安全重跑） */
export async function confirmSettlementAction(periodKey: string): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  if (!isPeriodKey(periodKey)) return { ok: false, error: "归属期格式应为 YYYY-MM" };

  const res = await confirmPeriod(periodKey, admin.id);
  if (!res.ok) return { ok: false, error: res.error };
  await audit(
    admin.id,
    "CONFIRM_SETTLEMENT",
    "INCENTIVE_PERIOD",
    res.periodId,
    `${periodKey} 入账 ${res.credited} 人 / ${res.coin} PIX`,
  );
  revalidateSettlement();
  revalidatePath("/creators/me");
  revalidatePath("/me/coins");
  return { ok: true };
}

/** 重置草稿（按新配置重算）。已入账的期不可重置 */
export async function resetDraftAction(periodKey: string): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const res = await resetDraftPeriod(periodKey);
  if (!res.ok) return { ok: false, error: res.error ?? "重置失败" };
  await audit(admin.id, "RESET_SETTLEMENT_DRAFT", "INCENTIVE_PERIOD", undefined, periodKey);
  revalidateSettlement();
  return { ok: true };
}

/**
 * 手动标记某期已发放。
 * 只在「人已线下核对过全部提现都处理完」时才该点 —— 它不发起任何资金动作，
 * 只是把状态推进到终态（系统绝不自动打款，计划 §13）。
 */
export async function markPeriodPaidAction(periodKey: string): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };
  const upd = await prisma.incentivePeriod.updateMany({
    where: { periodKey, status: "CONFIRMED" },
    data: { status: "PAID" },
  });
  if (upd.count === 0) return { ok: false, error: "该期不是「已确认」状态" };
  await audit(admin.id, "MARK_PERIOD_PAID", "INCENTIVE_PERIOD", undefined, periodKey);
  revalidateSettlement();
  return { ok: true };
}
