"use server";

// 提现 action：用户自助申请 + 后台审核（通过 / 驳回 / 打款回填）。
//
// 【系统绝不自动打款】这是已锁定的决定（计划 §13）：通过只是「同意处理」，
// 真钱由管理员线下转出后回来回填流水号。`PAID` 是人工确认的结果，不是系统猜测的结果。
//
// 【提现申请的两道闸门】① 用户侧：门槛 / 冷却 / 可用余额；② 平台侧：现金水位
// （`C ≥ Σ未打款提现 + 本次`）。第 ② 道用 `checkWithdrawGate` —— 与 /fund、/admin/withdrawals
// 顶部水位**同一个函数**，不允许各算一遍（验收项「公示页可追溯」）。
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { adminOnly, audit } from "@/lib/actions/_guards";
import { getIncentive } from "@/lib/incentive";
import { getCoinAccount, freezeForWithdrawal, markWithdrawalPaid, refundWithdrawal } from "@/lib/coin";
import { checkWithdrawGate, getSolvency } from "@/lib/coin";
import { coinToFen } from "@/lib/points-config";
import { createNotification } from "@/lib/notify";
import { recordLedger } from "@/lib/ledger";
import { monthKey } from "@/lib/format";
import type { ActionResult } from "@/lib/hooks";

function revalidateWithdrawal() {
  revalidatePath("/me/coins");
  revalidatePath("/admin/withdrawals");
  revalidatePath("/admin/finance");
  revalidatePath("/fund");
}

/** 收款信息格式：姓名｜账号（一个字段存，避免再开两列；仅 adminOnly 可见） */
function packAccount(name: string, account: string): string {
  return `${name.trim().slice(0, 40)}｜${account.trim().slice(0, 120)}`;
}

/** 用户发起提现 */
export async function requestWithdrawalAction(input: {
  coin: number;
  method: string;
  name: string;
  account: string;
}): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "请先登录" };

  const cfg = await getIncentive();
  if (!cfg.withdraw.enabled) return { ok: false, error: "提现功能当前未开放" };

  const coin = Math.trunc(input.coin);
  if (!Number.isFinite(coin) || coin <= 0) return { ok: false, error: "提现数量不合法" };
  if (coin < cfg.withdraw.minCoin) {
    return { ok: false, error: `提现门槛为 ${cfg.withdraw.minCoin} ${cfg.coin.symbol}` };
  }

  const method = input.method === "wechat" ? "wechat" : "alipay";
  if (!input.name.trim() || !input.account.trim()) {
    return { ok: false, error: "请填写收款姓名与账号" };
  }

  // 冷却：两次提现之间至少间隔 N 天（防刷单申请）
  if (cfg.withdraw.cooldownDays > 0) {
    const last = await prisma.withdrawalRequest.findFirst({
      where: { userId, status: { not: "REJECTED" } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last) {
      const nextAt = new Date(last.createdAt.getTime() + cfg.withdraw.cooldownDays * 86400_000);
      if (nextAt.getTime() > Date.now()) {
        return {
          ok: false,
          error: `距上次提现不足 ${cfg.withdraw.cooldownDays} 天，请在 ${nextAt.toLocaleDateString("zh-CN")} 后再试`,
        };
      }
    }
  }

  const account = await getCoinAccount(userId);
  if (account.balance < coin) {
    return { ok: false, error: `可用 ${cfg.coin.symbol} 不足（当前 ${account.balance}）` };
  }

  const grossFen = coinToFen(coin, cfg.coin.perYuan);
  const feeFen = Math.min(cfg.withdraw.feeFen, grossFen);
  const fiatFen = grossFen - feeFen; // 实际打款额（现金流出以此为准）
  if (fiatFen <= 0) return { ok: false, error: "折算金额为 0，请提高提现数量" };

  // 平台侧水位：C ≥ Σ(未打款提现) + 本次
  const solvency = await getSolvency();
  const gate = checkWithdrawGate(solvency, fiatFen);
  if (!gate.ok) return { ok: false, error: gate.message };

  const request = await prisma.withdrawalRequest.create({
    data: {
      userId,
      coinAmount: coin,
      fiatFen,
      rateSnapshot: cfg.coin.perYuan,
      feeFen,
      // 需人工审核时停 PENDING；关掉审核则直接 APPROVED 等打款（仍然不会自动出钱）
      status: cfg.withdraw.manualReview ? "PENDING" : "APPROVED",
      method,
      accountInfo: packAccount(input.name, input.account),
    },
    select: { id: true },
  });

  const frozen = await prisma.$transaction((tx) =>
    freezeForWithdrawal(tx, { userId, coin, withdrawalId: request.id }),
  );
  if (!frozen) {
    // 冻结失败（并发下余额刚被用掉）：撤掉申请，别留一张兑不出来的单
    await prisma.withdrawalRequest.delete({ where: { id: request.id } }).catch(() => {});
    return { ok: false, error: `可用 ${cfg.coin.symbol} 不足` };
  }

  await createNotification({
    userId,
    type: "SYSTEM",
    message: `提现申请已提交：${coin} ${cfg.coin.symbol}（预计到账 ${(fiatFen / 100).toFixed(2)} 元），等待处理`,
  });
  revalidateWithdrawal();
  return { ok: true };
}

/** 后台通过 / 驳回 */
export async function reviewWithdrawalAction(input: {
  id: string;
  decision: "approve" | "reject";
  note?: string;
}): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const req = await prisma.withdrawalRequest.findUnique({
    where: { id: input.id },
    select: { id: true, userId: true, coinAmount: true, fiatFen: true, status: true },
  });
  if (!req) return { ok: false, error: "申请不存在" };

  if (input.decision === "approve") {
    if (req.status !== "PENDING") return { ok: false, error: "只有待审核的申请可通过" };
    const upd = await prisma.withdrawalRequest.updateMany({
      where: { id: req.id, status: "PENDING" },
      data: { status: "APPROVED", handledBy: admin.id, handledAt: new Date() },
    });
    if (upd.count === 0) return { ok: false, error: "状态已变化，请刷新" };
    await createNotification({
      userId: req.userId,
      type: "SYSTEM",
      message: "提现申请已通过审核，等待打款",
    });
  } else {
    if (req.status !== "PENDING" && req.status !== "APPROVED") {
      return { ok: false, error: "该申请已终结，不能驳回" };
    }
    // 驳回必须解冻：钱要原样退回可用余额（否则用户的钱就卡死了）
    const rejected = await prisma.$transaction(async (tx) => {
      const upd = await tx.withdrawalRequest.updateMany({
        where: { id: req.id, status: { in: ["PENDING", "APPROVED"] } },
        data: {
          status: "REJECTED",
          handledBy: admin.id,
          handledAt: new Date(),
          rejectNote: input.note?.trim().slice(0, 200) || null,
        },
      });
      if (upd.count === 0) return false;
      await refundWithdrawal(tx, {
        userId: req.userId,
        coin: req.coinAmount,
        withdrawalId: req.id,
      });
      return true;
    });
    if (!rejected) return { ok: false, error: "状态已变化，请刷新" };
    await createNotification({
      userId: req.userId,
      type: "SYSTEM",
      message: `提现申请未通过${input.note?.trim() ? `：${input.note.trim()}` : ""}，金额已退回余额`,
    });
  }

  await audit(
    admin.id,
    input.decision === "approve" ? "APPROVE_WITHDRAWAL" : "REJECT_WITHDRAWAL",
    "WITHDRAWAL",
    req.id,
    input.note,
  );
  revalidateWithdrawal();
  return { ok: true };
}

/**
 * 打款完成回填流水号。
 * 走到这里才真正产生现金流出：`frozen −N` + `LedgerEntry(WITHDRAWAL_PAID, OUT)`。
 */
export async function markWithdrawalPaidAction(input: {
  id: string;
  payRef: string;
}): Promise<ActionResult> {
  const admin = await adminOnly();
  if (!admin) return { ok: false, error: "仅管理员可操作" };

  const req = await prisma.withdrawalRequest.findUnique({
    where: { id: input.id },
    select: { id: true, userId: true, coinAmount: true, fiatFen: true, status: true },
  });
  if (!req) return { ok: false, error: "申请不存在" };
  if (req.status !== "APPROVED") return { ok: false, error: "只有已通过的申请可打款" };

  const payRef = input.payRef.trim().slice(0, 80);
  if (!payRef) return { ok: false, error: "请填写打款流水号" };

  const done = await prisma.$transaction(async (tx) => {
    const upd = await tx.withdrawalRequest.updateMany({
      where: { id: req.id, status: "APPROVED" },
      data: { status: "PAID", paidAt: new Date(), payRef },
    });
    if (upd.count === 0) return false;
    await markWithdrawalPaid(tx, { userId: req.userId, coin: req.coinAmount });
    await recordLedger(tx, {
      kind: "WITHDRAWAL_PAID",
      amountFen: req.fiatFen,
      periodKey: monthKey(new Date()),
      refType: "WITHDRAWAL",
      refId: req.id,
      note: `提现打款 ${req.coinAmount} PIX`,
      createdBy: admin.id,
    });
    return true;
  });
  if (!done) return { ok: false, error: "状态已变化，请刷新" };

  await createNotification({
    userId: req.userId,
    type: "SYSTEM",
    message: `提现已打款：${(req.fiatFen / 100).toFixed(2)} 元，流水号 ${payRef}`,
  });
  await audit(admin.id, "PAY_WITHDRAWAL", "WITHDRAWAL", req.id, payRef);
  revalidateWithdrawal();
  return { ok: true };
}
