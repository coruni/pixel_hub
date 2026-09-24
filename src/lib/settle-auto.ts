// 自动结算调度 —— 把「已到期」的结算期推进到 CONFIRMED 并逐人入账 PIX。
//
// 【边界：只到「入账」】打款永远是人工（计划 §13「系统绝不自动打款」）。
// 这里做的事与管理员在后台点「确认结算」完全相同，只是触发者换成了定时器。
//
// 【为什么必须按月顺序串行补齐】`carryInOf()` 只读**上一期**、且要求它非 DRAFT。
// 跳过 8 月直接确认 9 月，8 月的 `carryOutFen` 就永远进不了 9 月（9 月已成快照，不可重算）。
// 所以入口是「一端区间」而不是「一个月」：从最早的缺口期开始一个月一个月往前推。
//
// 【三种「不动手」要分清，混了就会丢钱或刷屏】
//   ① 该期已有非 DRAFT 记录      → 已完成，跳过继续。
//   ② 该期没有可发放明细          → 跳过继续。它本来就没有行，`carryInOf` 天然返回 0，
//                                   不构成结转断点（但若池子有余额，钱会一直挂起，记警告）。
//   ③ 偿付闸门拒绝 / 基础设施异常 → **中断整轮**而不是跳过：后续月份的 carryIn 依赖它，
//                                   硬结会让链条上的钱错位。等 autoRetryHours 后重来。
//
// 【并发】`IncentivePeriod.periodKey` 是 `@unique`，两个实例同时走到 create 会抛 P2002。
// 本文件把 P2002 当成「别的实例已经做完了」处理，不当作失败（confirmPeriod 自己不 catch 它）。
import { prisma } from "@/lib/db/prisma";
import { getIncentive } from "@/lib/incentive";
import { buildDraft, confirmPeriod } from "@/lib/settle";
import { duePeriodKey, settleWindowKeys, shiftPeriodKey } from "@/lib/settle-allocate";

/**
 * 自动结算的「操作人」标识。
 * `AuditLog.adminId` 与 `IncentivePeriod.confirmedBy` 都是**无外键的普通 String**，
 * 所以不需要造一个系统账号，写这个哨兵值即可（后台日志里一眼能认出来是机器干的）。
 */
export const AUTO_SETTLE_ACTOR = "system";

export type AutoSettleStep = {
  periodKey: string;
  action: "confirmed" | "preview" | "skipped" | "failed";
  credited?: number;
  coin?: number;
  reason?: string;
};

export type AutoSettleResult = {
  /** 本轮是否真正执行了检查（被开关或节流挡下时为 false） */
  ran: boolean;
  /** 预演：只算不写，用于「打开开关前先看会结掉什么」 */
  dryRun: boolean;
  /** 未执行的原因（仅 ran=false 时有值） */
  skippedReason?: string;
  /** 实际考察的区间（升序，含两端） */
  keys: string[];
  steps: AutoSettleStep[];
  confirmedCount: number;
  /** 本轮入账的 PIX 总数 */
  coin: number;
  /** 预演模式下「将会入账」的 PIX 总数 */
  previewCoin: number;
  /** 是否因偿付闸门 / 异常而中断（下轮重试） */
  blocked: boolean;
};

/**
 * 写审计日志（与后台手点确认同一条 `CONFIRM_SETTLEMENT`，操作人是 `system`）。
 *
 * **懒加载** `_guards`：它连带引入 `@/lib/auth`，而本模块会被 `src/instrumentation.ts`
 * 在启动早期加载 —— 不让认证栈进入启动路径。`audit()` 自身吞错，这里再包一层只为
 * 「连模块都加载不出来」时也别打断结算。
 */
async function writeAudit(periodId: string, note: string): Promise<void> {
  try {
    const { audit } = await import("@/lib/actions/_guards");
    await audit(AUTO_SETTLE_ACTOR, "CONFIRM_SETTLEMENT", "INCENTIVE_PERIOD", periodId, note);
  } catch (e) {
    console.error("[settle:auto] 审计日志写入失败:", e);
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function emptyResult(ran: boolean, skippedReason?: string, dryRun = false): AutoSettleResult {
  return {
    ran,
    dryRun,
    skippedReason,
    keys: [],
    steps: [],
    confirmedCount: 0,
    coin: 0,
    previewCoin: 0,
    blocked: false,
  };
}

/**
 * 考察 `[fromKey, toKey]` 并串行确认其中的缺口期。
 *
 * `force=true` 表示由带密钥的补跑端点显式调用 —— 此时**忽略** `settlement.autoEnabled`
 * 开关（人工补跑历史缺口本就是它的用途），但仍尊重激励体系总开关。
 */
export async function runAutoSettle(
  opts: { now?: Date; force?: boolean; fromKey?: string; toKey?: string; dryRun?: boolean } = {},
): Promise<AutoSettleResult> {
  const now = opts.now ?? new Date();
  const cfg = await getIncentive();

  if (!cfg.enabled) return emptyResult(false, "激励体系已关闭");
  if (!opts.force && !cfg.settlement.autoEnabled) return emptyResult(false, "自动结算未开启");

  const dryRun = opts.dryRun === true;
  const maxMonths = Math.max(1, Math.trunc(cfg.settlement.autoMaxBackfillMonths));
  const toKey = opts.toKey ?? duePeriodKey(now, cfg.settlement.autoDelayDays);
  // 默认从「应结月往前 maxMonths−1 个月」开始；显式传 fromKey 时才用调用方的区间
  const fromKey = opts.fromKey ?? shiftPeriodKey(toKey, -(maxMonths - 1)) ?? toKey;
  const keys = settleWindowKeys(fromKey, toKey, maxMonths);

  const result: AutoSettleResult = { ...emptyResult(true, undefined, dryRun), keys };

  for (const key of keys) {
    const existing = await prisma.incentivePeriod.findUnique({
      where: { periodKey: key },
      select: { status: true },
    });
    if (existing && existing.status !== "DRAFT") {
      result.steps.push({ periodKey: key, action: "skipped", reason: `已是 ${existing.status}` });
      continue;
    }

    // 先读只读草稿判断前置条件：资金闸门、有无可发放明细、门槛是否拦住所有人
    const draft = await buildDraft(key);
    if (!draft) {
      result.blocked = true;
      result.steps.push({ periodKey: key, action: "failed", reason: "归属期格式不正确" });
      break;
    }
    if (draft.outcome.rows.length === 0) {
      result.steps.push({
        periodKey: key,
        action: "skipped",
        reason:
          draft.poolFen > 0
            ? `池子有 ${draft.poolFen} 分余额但本期无可发放明细（无人达标 / 全部低于最低发放额），钱会一直挂起`
            : "本期无可发放明细",
      });
      continue;
    }
    if (!draft.canConfirm) {
      result.blocked = true;
      result.steps.push({
        periodKey: key,
        action: "failed",
        reason: draft.gate.message ?? "偿付闸门未通过",
      });
      break;
    }

    // 预演：闸门与明细都过了，但一个字都不写。用于「打开开关前先看会结掉什么」。
    if (dryRun) {
      result.previewCoin += draft.newCoin;
      result.steps.push({
        periodKey: key,
        action: "preview",
        credited: draft.outcome.rows.length,
        coin: draft.newCoin,
        reason: `将确认 ${draft.outcome.rows.length} 条明细 / ${draft.newCoin} PIX，池子 ${draft.poolFen} 分`,
      });
      continue;
    }

    try {
      const res = await confirmPeriod(key, AUTO_SETTLE_ACTOR);
      if (!res.ok) {
        result.blocked = true;
        result.steps.push({ periodKey: key, action: "failed", reason: res.error });
        break;
      }
      result.confirmedCount += 1;
      result.coin += res.coin;
      result.steps.push({ periodKey: key, action: "confirmed", credited: res.credited, coin: res.coin });
      await writeAudit(res.periodId, `${key} 自动结算：入账 ${res.credited} 人 / ${res.coin} PIX`);
    } catch (e) {
      if (isUniqueViolation(e)) {
        result.steps.push({ periodKey: key, action: "skipped", reason: "并发下已被其他实例确认" });
        continue;
      }
      result.blocked = true;
      result.steps.push({ periodKey: key, action: "failed", reason: errText(e) });
      break;
    }
  }

  return result;
}

// ---------- 进程内节流与单飞 ----------
// 挂在 globalThis 上：Next.js 的 HMR / 多份模块实例共享同一状态，避免重复起跑。

type AutoState = { lastRunAt: number; inflight: Promise<AutoSettleResult> | null };

const globalRef = globalThis as typeof globalThis & { __pixAutoSettle?: AutoState };

function state(): AutoState {
  globalRef.__pixAutoSettle ??= { lastRunAt: 0, inflight: null };
  return globalRef.__pixAutoSettle;
}

/**
 * 定时器入口：带单飞锁与 `autoRetryHours` 节流。
 * 未开自动结算时**不消耗节流窗口**（否则刚打开开关还要白等一轮）。
 */
export async function maybeAutoSettle(now = new Date()): Promise<AutoSettleResult> {
  const s = state();
  if (s.inflight) return s.inflight;

  const cfg = await getIncentive();
  if (!cfg.enabled || !cfg.settlement.autoEnabled) return emptyResult(false, "自动结算未开启");
  // 每日尝试时点：过了这个点才动手，给收入录入留出固定的核对窗口。
  // 放在节流判断**之前**，这样「还没到点」不会消耗掉重试窗口。
  if (now.getHours() < cfg.settlement.autoHour) {
    return emptyResult(false, `未到每日尝试时点（${cfg.settlement.autoHour} 点）`);
  }

  const gapMs = Math.max(1, Math.trunc(cfg.settlement.autoRetryHours)) * 3_600_000;
  if (Date.now() - s.lastRunAt < gapMs) return emptyResult(false, "未满重试间隔");

  s.lastRunAt = Date.now();
  s.inflight = runAutoSettle({ now }).finally(() => {
    s.inflight = null;
  });
  return s.inflight;
}

/** 单行摘要，供定时器与补跑端点打日志（`[tag]` 前缀便于检索） */
export function summarize(r: AutoSettleResult): string {
  if (!r.ran) return `[settle:auto] 未执行：${r.skippedReason ?? "未知原因"}`;
  const parts = r.steps.map((s) => {
    if (s.action === "confirmed") return `${s.periodKey} 已确认（${s.credited} 人 / ${s.coin} PIX）`;
    if (s.action === "preview") return `${s.periodKey} 预演将入账 ${s.coin} PIX`;
    if (s.action === "skipped") return `${s.periodKey} 跳过（${s.reason}）`;
    return `${s.periodKey} 失败（${s.reason}）`;
  });
  const head = r.dryRun ? "[settle:auto] 预演" : "[settle:auto]";
  const tag = r.blocked ? " ⚠ 已中断，下轮重试" : "";
  const span = `${r.keys[0] ?? "-"} → ${r.keys[r.keys.length - 1] ?? "-"}`;
  return `${head} 考察 ${span}：${parts.join("；") || "无事可做"}${tag}`;
}
