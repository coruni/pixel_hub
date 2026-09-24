// 结算分配 —— **纯函数层**（无 DB、无 server 依赖，可被脚本与单测直接调用）。
//
// 【为什么必须是纯函数】/fund 与 /admin/settlement 会公示每一期的分配明细。
// 公示的前提是「谁都能按同样的输入复算出同样的每一分钱」—— 只要算法里掺了时间、
// 随机数或数据库读取顺序，这个前提就没了。
//
// 【最大余数法】`raw_i = P × score_i / Σscore` 逐人取 floor 后一定会有残值
// （Σfloor ≤ P 且差额 < 人数）。残值按**小数部分降序**逐人 +1 分，
// 保证 ΣamountFen 精确等于池子，且结果唯一确定（同分同余时按 score 降序、userId 升序定序）。
//
// 【单人封顶】有人超 `P × capPermille/10000` 时固定为封顶值，溢出额回流给其余人再分，
// 最多 `capIterations` 轮；若轮次用尽仍有人超（分数极度集中），最后一轮**硬钳**到封顶，
// 溢出与残值一同计入 `carryOutFen` 结转下期 —— 池子永远守恒，封顶永远是硬的。
//
// 【大数安全】`P × score` 在极端配置下会超过 `Number.MAX_SAFE_INTEGER`，
// 所以乘除一律走 BigInt；对外 API 仍是 number（金额与分值都在安全整数范围内）。
import { PERMILLE_BASE } from "@/lib/points-config";

export type AllocEntry = { userId: string; score: number };

export type AllocOpts = {
  /** 结算分门槛：低于门槛不参与本期分配（其份额回流给其余人 —— 它们不在 Σscore 里） */
  minScore: number;
  /** 最低发放额（分）：分配到了但低于此额不发，转入下期池 */
  minPayoutFen: number;
  /** 单人单期封顶（万分比，占池子比例）；≥ 10000 视为不封顶 */
  capPermille: number;
  /** 封顶溢出的最大迭代轮数 */
  capIterations: number;
};

export type AllocRow = {
  userId: string;
  score: number;
  amountFen: number;
  capped: boolean;
  /** 名次（1 起；仅在实际发放的行里有意义） */
  rank: number;
};

export type AllocOutcome = {
  /** 实际发放的行（amountFen ≥ minPayoutFen），已按名次排序 */
  rows: AllocRow[];
  /** 因低于最低发放额而不发的行（转入下期池） */
  belowMin: AllocRow[];
  /** 低于结算分门槛、未参与分配的人 */
  excluded: AllocEntry[];
  /** Σ rows.amountFen */
  paidFen: number;
  /** 池子 − 已发 = 门槛过滤 + 最低额过滤 + 取整/封顶溢出残值；下期**全额**结转 */
  carryOutFen: number;
};

/**
 * 把 `poolFen` 按 `score` 权重分给各人。相同输入必须逐分相同输出。
 */
export function allocate(poolFen: number, entries: AllocEntry[], opts: AllocOpts): AllocOutcome {
  const pool = Math.max(0, Math.trunc(poolFen));

  const eligible = entries.filter((e) => e.score >= opts.minScore && e.score > 0);
  const excluded = entries.filter((e) => !(e.score >= opts.minScore && e.score > 0));
  if (pool === 0 || eligible.length === 0) {
    return { rows: [], belowMin: [], excluded, paidFen: 0, carryOutFen: pool };
  }

  const capped = opts.capPermille < PERMILLE_BASE;
  const capFen = capped
    ? Number((BigInt(pool) * BigInt(opts.capPermille)) / BigInt(PERMILLE_BASE))
    : pool;

  const fixed = new Map<string, { score: number; amountFen: number; capped: boolean }>();
  let active = eligible;
  let remaining = pool;
  let done = false;

  const rounds = Math.max(1, Math.trunc(opts.capIterations));
  for (let round = 0; round < rounds && active.length > 0; round += 1) {
    const shares = distribute(remaining, active);
    const scoreOf = new Map(active.map((e) => [e.userId, e.score]));
    if (!capped) {
      commit(fixed, shares, scoreOf, false);
      remaining = 0;
      done = true;
      break;
    }
    const over = [...shares.entries()].filter(([, v]) => v > capFen);
    if (over.length === 0) {
      commit(fixed, shares, scoreOf, false);
      remaining = 0;
      done = true;
      break;
    }
    const isLastRound = round === rounds - 1;
    const keep = new Set(active.map((e) => e.userId));

    if (isLastRound) {
      // 轮次用尽仍有人超封顶：硬钳到封顶，超出部分进 carry（池子守恒，封顶不破）
      for (const [id, v] of shares) {
        const amt = Math.min(v, capFen);
        fixed.set(id, { score: scoreOf.get(id) ?? 0, amountFen: amt, capped: v > capFen });
        remaining -= amt;
      }
      active = [];
      done = true;
      break;
    }

    for (const [id] of over) {
      fixed.set(id, { score: scoreOf.get(id) ?? 0, amountFen: capFen, capped: true });
      remaining -= capFen;
      keep.delete(id);
    }
    active = active.filter((e) => keep.has(e.userId));
  }

  // 兜底：迭代正常结束时 active 已清空且 remaining 已归零；万一留下，全进 carry
  if (!done && active.length > 0) {
    const shares = distribute(remaining, active);
    commit(fixed, shares, new Map(active.map((e) => [e.userId, e.score])), false);
    remaining = 0;
  }

  const all: AllocRow[] = [...fixed.entries()].map(([userId, v]) => ({
    userId,
    score: v.score,
    amountFen: v.amountFen,
    capped: v.capped,
    rank: 0,
  }));
  // 名次：分值降序，同分按 userId 升序（确定性）
  all.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.userId < b.userId ? -1 : 1));

  const rows: AllocRow[] = [];
  const belowMin: AllocRow[] = [];
  for (const r of all) {
    if (r.amountFen >= opts.minPayoutFen && r.amountFen > 0) {
      r.rank = rows.length + 1;
      rows.push(r);
    } else {
      belowMin.push(r);
    }
  }
  const paidFen = rows.reduce((s, r) => s + r.amountFen, 0);
  return { rows, belowMin, excluded, paidFen, carryOutFen: pool - paidFen };
}

/** 最大余数法核心：Σ返回值 恒等于 `pool` */
function distribute(pool: number, entries: AllocEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  if (pool <= 0 || entries.length === 0) return out;
  const total = entries.reduce((s, e) => s + e.score, 0);
  if (total <= 0) return out;

  const P = BigInt(pool);
  const T = BigInt(total);
  const parts = entries.map((e) => {
    const num = P * BigInt(e.score);
    return { id: e.userId, score: e.score, base: num / T, rem: num % T };
  });

  let assigned = BigInt(0);
  for (const p of parts) {
    out.set(p.id, Number(p.base));
    assigned += p.base;
  }
  const rest = P - assigned; // 恒 < parts.length
  const order = [...parts].sort((a, b) => {
    if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (let i = 0; i < Number(rest); i += 1) {
    const id = order[i]!.id;
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

function commit(
  target: Map<string, { score: number; amountFen: number; capped: boolean }>,
  shares: Map<string, number>,
  scoreOf: Map<string, number>,
  capped: boolean,
): void {
  for (const [id, v] of shares) {
    const prev = target.get(id);
    if (prev) prev.amountFen += v;
    else target.set(id, { score: scoreOf.get(id) ?? 0, amountFen: v, capped });
  }
}

// ---------- 归属期（纯字符串/日期运算，无 DB） ----------

export type PeriodRange = { start: Date; end: Date; periodKey: string; label: string };

const PERIOD_RE = /^(\d{4})-(\d{2})$/;

/** `"2026-09"` → 该自然月的 [start, end)（本地时区，与 monthKey 同一口径） */
export function periodRange(periodKey: string): PeriodRange | null {
  const m = PERIOD_RE.exec(periodKey);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return {
    start: new Date(year, month - 1, 1, 0, 0, 0, 0),
    end: new Date(year, month, 1, 0, 0, 0, 0),
    periodKey,
    label: `${year} 年 ${month} 月`,
  };
}

/** 上一期 key；非法输入返回 null */
export function prevPeriodKey(periodKey: string): string | null {
  const m = PERIOD_RE.exec(periodKey);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const d = new Date(year, month - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isPeriodKey(v: string): boolean {
  return periodRange(v) !== null;
}

/** `"2026-09"` 前后移动 n 个月（n 为正=向后）；非法输入返回 null（月份范围与 periodRange 同口径） */
export function shiftPeriodKey(periodKey: string, months: number): string | null {
  const m = PERIOD_RE.exec(periodKey);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const d = new Date(Number(m[1]), month - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 自动结算的「当前应结的最后一期」：归属月 M 在「M 结束后再过 `delayDays` 天」才到期。
 * 所以本月的 1 号到 `delayDays` 号之间，还只该结到**上上月**。
 *
 * 与 `periodRange` / `monthKey` 同一时区口径（本机日历月）—— 容器里必须设 TZ，
 * 否则窗口边界与触发时点会整体错位。
 */
export function duePeriodKey(now: Date, delayDays: number): string {
  const back = now.getDate() <= delayDays ? 2 : 1;
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * `[fromKey, toKey]` 的升序月份列表，最多 `max` 项；超出时**保留靠近 `toKey` 的那一段**
 * （补跑要先补最近的，久远的月份即使漏了也不该挤掉当期）。
 * `YYYY-MM` 是定长零填充，字符串比较即时间序，不需要再解析日期。
 */
export function settleWindowKeys(fromKey: string, toKey: string, max: number): string[] {
  const out: string[] = [];
  let k: string | null = toKey;
  while (k && k >= fromKey && out.length < Math.max(0, Math.trunc(max))) {
    out.push(k);
    k = prevPeriodKey(k);
  }
  return out.reverse();
}
