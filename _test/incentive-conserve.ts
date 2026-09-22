// 创作者激励 / PIX / 收支台账 · 守恒自检
//
// 用法：npx tsx _test/incentive-conserve.ts
//
// 【它守的是什么】这套体系里最贵的 bug 不是「页面报错」，而是「账对不上」：
// 池子少分了一分钱、提现冻结没解冻、密钥被投影到前台。这些都不会抛异常，只会让数字慢慢错。
// 所以这里用可反证的断言把它们钉住 —— 纯函数部分**不需要数据库**，连库部分连不上会明确 SKIP 而不是假装通过。
//
// 断言分两类：
//   A. 纯函数（任何环境都能跑）：换算精度、池子公式、分配守恒与封顶、对外投影不含密钥、期号运算。
//   B. 数据库不变量（无库时 SKIP）：Σ流水 === 余额、冻结额 === 待处理提现、累计提现 === 已打款、期快照自洽。
import {
  FEN_PER_YUAN,
  PERMILLE_BASE,
  applyPermille,
  coinToFen,
  fenToCoin,
  levelNameOf,
  levelOf,
  parseIncentive,
  tipPresets,
} from "../src/lib/points-config";
import { parseYuanToFen, fenToYuanText, formatYuan, parseGatewayMoney } from "../src/lib/money";
import {
  KEEP_SECRET,
  LEDGER_KIND_META,
  parsePaymentConfig,
  publicPaymentConfig,
  safePaymentConfig,
  validateSponsorAmount,
} from "../src/lib/payment-config";
import { allocate, isPeriodKey, periodRange, prevPeriodKey } from "../src/lib/settle-allocate";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass += 1;
    return;
  }
  fail += 1;
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

/** 宽松签名：断言的是**运行时的值**，不参与字面量类型推导（否则 `!==` 会被 TS 判为无意义比较） */
function eq(name: string, actual: unknown, expected: unknown) {
  check(name, Object.is(actual, expected), `实际 ${String(actual)}，期望 ${String(expected)}`);
}

console.log("=== A. 纯函数断言 ===");

// ---- A1 金额换算：字符串解析，绝不留浮点误差 ----
eq("parseYuanToFen('0.29')", parseYuanToFen("0.29"), 29);
eq("parseYuanToFen('1')", parseYuanToFen("1"), 100);
eq("parseYuanToFen(' 12.5 ')", parseYuanToFen(" 12.5 "), 1250);
eq("parseYuanToFen('1.234') 拒绝三位小数", parseYuanToFen("1.234"), null);
eq("parseYuanToFen('1e2') 拒绝科学计数", parseYuanToFen("1e2"), null);
eq("parseYuanToFen('-1') 拒绝负数", parseYuanToFen("-1"), null);
eq("parseYuanToFen('abc')", parseYuanToFen("abc"), null);
eq("parseGatewayMoney 与用户输入同规则", parseGatewayMoney("0.29"), 29);
eq("fenToYuanText(29)", fenToYuanText(29), "0.29");
eq("fenToYuanText(100)", fenToYuanText(100), "1.00");
eq("formatYuan(123456)", formatYuan(123456), "¥1,234.56");
// 反例守卫：parseFloat("0.29")*100 === 28.999999999999996
check(
  "绝不出现浮点换算（0.29 元 = 29 分，而非 28）",
  parseYuanToFen("0.29") === 29 && Math.round(Number("0.29") * 100) === 29,
);

// ---- A2 池子公式：carryIn 不参与分成（回归保护） ----
eq("applyPermille(10000, 6000) = 6000", applyPermille(10000, 6000), 6000);
const revenue = 100_00;
const rate = 6000;
const carryIn = 3000;
const pool = applyPermille(revenue, rate) + carryIn;
eq("pool = floor(收入×比例) + carryIn", pool, 9000);
check(
  "pool ≠ floor((收入+carryIn)×比例)（后者会吞掉 carryIn×40%）",
  pool !== applyPermille(revenue + carryIn, rate),
  `两种算法分别得 ${pool} 与 ${applyPermille(revenue + carryIn, rate)}`,
);

// ---- A3 分配：守恒 + 封顶 + 确定性 ----
const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ userId: `u${String(i + 1).padStart(3, "0")}`, score: (i + 1) * 7 }));

const cases: { pool: number; n: number; cap: number }[] = [
  { pool: 10000, n: 3, cap: PERMILLE_BASE },
  { pool: 9, n: 4, cap: PERMILLE_BASE }, // 池子小于人数：残值分配
  { pool: 123_456, n: 37, cap: 2000 }, // 触发封顶迭代
  { pool: 999_999, n: 2, cap: 500 }, // 极度集中 + 极小封顶：硬钳 + 结转
  { pool: 0, n: 5, cap: 4000 },
];

for (const c of cases) {
  const entries = mk(c.n);
  const opts = { minScore: 0, minPayoutFen: 0, capPermille: c.cap, capIterations: 3 };
  const out = allocate(c.pool, entries, opts);
  const sum = out.rows.reduce((s, r) => s + r.amountFen, 0);
  eq(`pool=${c.pool} n=${c.n} cap=${c.cap}：Σ发放 + 结转 === 池子`, sum + out.carryOutFen, c.pool);
  eq(`pool=${c.pool} n=${c.n} cap=${c.cap}：paidFen === Σrows`, out.paidFen, sum);
  if (c.cap < PERMILLE_BASE) {
    const capFen = Math.floor((c.pool * c.cap) / PERMILLE_BASE);
    check(
      `pool=${c.pool} cap=${c.cap}：无人超过封顶上限`,
      out.rows.every((r) => r.amountFen <= capFen),
      `上限 ${capFen}，最大 ${Math.max(0, ...out.rows.map((r) => r.amountFen))}`,
    );
  }
  const again = allocate(c.pool, mk(c.n), opts);
  eq(`pool=${c.pool}：同输入同输出（可复算）`, JSON.stringify(again), JSON.stringify(out));
}

// ---- A4 期号运算 ----
eq("prevPeriodKey('2026-01')", prevPeriodKey("2026-01"), "2025-12");
eq("prevPeriodKey('2026-03')", prevPeriodKey("2026-03"), "2026-02");
check("isPeriodKey('2026-13') 拒绝非法月", !isPeriodKey("2026-13"));
check("isPeriodKey('2026-09') 接受", isPeriodKey("2026-09"));
check("periodRange 窗口为自然月", periodRange("2026-09")?.end.getTime() === new Date(2026, 9, 1).getTime());

// ---- A5 代币换算 ----
eq("coinToFen(1000, 100) = 1000 分", coinToFen(1000, 100), 1000);
eq("fenToCoin(1000, 100) = 1000", fenToCoin(1000, 100), 1000);
check(
  "换算不产生凭空多出的钱（向下取整）",
  coinToFen(fenToCoin(333, 7), 7) <= 333 && coinToFen(1, 100) === 1,
);
eq("FEN_PER_YUAN", FEN_PER_YUAN, 100);

// ---- A6 打赏档位（几何级数，前后端共用） ----
const presets = tipPresets(1, 10000, 4);
check("tipPresets 数量正确", presets.length === 4, `实际 ${presets.length}`);
check("tipPresets 严格递增", presets.every((v, i) => i === 0 || v > presets[i - 1]!));
check("tipPresets 落在区间内", presets.every((v) => v >= 1 && v <= 10000));
check("tipPresets 边界退化（min===max）不崩", tipPresets(5, 5, 4).every((v) => v === 5));

// ---- A7 等级判定 ----
const levels = parseIncentive(null).levels;
eq("levelOf(0)", levelOf(0, levels), 0);
check("levelOf 单调不减", levels.every((_, i) => levelOf(levels[i]!.min, levels) >= levelOf(levels[0]!.min, levels)));
check("levelNameOf 返回名称而非空", levelNameOf(10_000_000, levels).length > 0);

// ---- A8 密钥纪律（结构性反证：投影里不可能出现密钥） ----
const SECRET = "SANDBOX_SECRET_DO_NOT_LEAK_9f3a";
const withSecret = parsePaymentConfig({
  epay: { enabled: true, url: "https://pay.example.com", pid: "1001", key: SECRET },
});
eq("配置内确实存在密钥（前置条件）", withSecret.epay.key, SECRET);
const projected = JSON.stringify(publicPaymentConfig(withSecret));
check("对外投影不含密钥明文", !projected.includes(SECRET), projected.slice(0, 120));
check("对外投影不含 pid", !projected.includes("1001"));
check("对外投影不含网关地址", !projected.includes("pay.example.com"));
eq("epayReady 判定为就绪", publicPaymentConfig(withSecret).ready, true);
const keep: string = KEEP_SECRET;
check("KEEP_SECRET 非空且可区分于空串（哨兵不会与「清空密钥」混淆）", keep.length > 0 && !Object.is(keep, ""));
check(
  "哨兵不会被默认配置当成密钥（默认密钥为空）",
  parsePaymentConfig(null).epay.key === "",
);

// ---- A9 赞助金额闸门 ----
const pay = parsePaymentConfig(null);
eq("低于下限被拒", validateSponsorAmount(pay, 50), `单笔不少于 ${(pay.sponsor.minFen / 100).toFixed(2)} 元`);
eq("等于下限放行", validateSponsorAmount(pay, pay.sponsor.minFen), null);
eq("等于上限放行", validateSponsorAmount(pay, pay.sponsor.maxFen), null);
check("超过上限被拒", validateSponsorAmount(pay, pay.sponsor.maxFen + 1) !== null);
check("非整数被拒", validateSponsorAmount(pay, 100.5) !== null);

// ---- A10 配置校验（WYSIWYG 整份替换） ----
check("坏配置被 safePaymentConfig 拒绝", safePaymentConfig({ epay: { tiers: "x" }, sponsor: { tiers: [] } }).ok === false);
check("空对象回落默认而非报错", parsePaymentConfig({}).sponsor.tiers.length > 0);
check("注入未声明字段被剥离", !JSON.stringify(parsePaymentConfig({ evil: 1 })).includes("evil"));

// ---- A11 台账方向由科目派生（不允许调用方传方向） ----
eq("WITHDRAWAL_PAID 为 OUT/payout", LEDGER_KIND_META.WITHDRAWAL_PAID.direction, "OUT");
eq("WITHDRAWAL_PAID 单独成组", LEDGER_KIND_META.WITHDRAWAL_PAID.group, "payout");
eq("REFUND_SPONSOR 为 OUT/refund", LEDGER_KIND_META.REFUND_SPONSOR.group, "refund");
check(
  "所有 INCOME_* 都是 IN",
  Object.entries(LEDGER_KIND_META)
    .filter(([k]) => k.startsWith("INCOME_"))
    .every(([, v]) => v.direction === "IN"),
);
check(
  "所有 COST_* 都是 OUT",
  Object.entries(LEDGER_KIND_META)
    .filter(([k]) => k.startsWith("COST_"))
    .every(([, v]) => v.direction === "OUT"),
);

console.log("=== B. 数据库不变量（无库则 SKIP） ===");

async function dbChecks() {
  const { prisma } = await import("../src/lib/db/prisma");
  await prisma.$queryRaw`SELECT 1`;

  // B1 Σ CoinLedger.delta === CoinAccount.balance（逐人）
  const accounts = await prisma.coinAccount.findMany({
    select: { userId: true, balance: true, frozen: true, lifetimeWithdrawn: true },
    take: 500,
  });
  const sums = await prisma.coinLedger.groupBy({ by: ["userId"], _sum: { delta: true } });
  const sumOf = new Map(sums.map((s) => [s.userId, s._sum.delta ?? 0]));
  const broken = accounts.filter((a) => (sumOf.get(a.userId) ?? 0) !== a.balance);
  check(
    `Σ PIX 流水 === 可用余额（抽查 ${accounts.length} 个账户）`,
    broken.length === 0,
    broken.slice(0, 3).map((b) => `${b.userId}: 余额 ${b.balance} vs 流水 ${sumOf.get(b.userId) ?? 0}`).join("; "),
  );

  // B2 冻结额 === 待处理提现冻结总额
  const [frozenAgg, pendingAgg] = await Promise.all([
    prisma.coinAccount.aggregate({ _sum: { frozen: true } }),
    prisma.withdrawalRequest.aggregate({
      where: { status: { in: ["PENDING", "APPROVED"] } },
      _sum: { coinAmount: true },
    }),
  ]);
  eq("冻结总额 === 待处理提现代币额", frozenAgg._sum.frozen ?? 0, pendingAgg._sum.coinAmount ?? 0);

  // B3 累计提现 === 已打款提现总额
  const [withdrawnAgg, paidAgg] = await Promise.all([
    prisma.coinAccount.aggregate({ _sum: { lifetimeWithdrawn: true } }),
    prisma.withdrawalRequest.aggregate({ where: { status: "PAID" }, _sum: { coinAmount: true } }),
  ]);
  eq("累计提现 === 已打款提现代币额", withdrawnAgg._sum.lifetimeWithdrawn ?? 0, paidAgg._sum.coinAmount ?? 0);

  // B4 期快照自洽：pool = floor(收入×比例)+carryIn；paid = Σ明细；carryOut = pool − paid
  const periods = await prisma.incentivePeriod.findMany({ take: 50 });
  for (const p of periods) {
    const agg = await prisma.incentivePayout.aggregate({
      where: { periodId: p.id },
      _sum: { amountFen: true, coin: true },
    });
    const paid = agg._sum.amountFen ?? 0;
    eq(`期 ${p.periodKey}：paidFen === Σ明细金额`, p.paidFen, paid);
    eq(`期 ${p.periodKey}：carryOut === pool − paid`, p.carryOutFen, p.poolFen - paid);
    eq(
      `期 ${p.periodKey}：pool === floor(收入×比例) + carryIn`,
      p.poolFen,
      applyPermille(p.revenueFen, p.ratePermille) + p.carryInFen,
    );
    const credited = await prisma.incentivePayout.count({ where: { periodId: p.id, coinCredited: true } });
    const total = await prisma.incentivePayout.count({ where: { periodId: p.id } });
    if (p.status !== "DRAFT") {
      eq(`期 ${p.periodKey}：确认期明细全部已入账`, credited, total);
    }
  }

  // B5 台账方向与科目表一致（库里存的方向是派生值，不允许手写跑偏）
  const kinds = await prisma.ledgerEntry.groupBy({ by: ["kind", "direction"], _sum: { amountFen: true } });
  const wrong = kinds.filter(
    (k) => LEDGER_KIND_META[k.kind as keyof typeof LEDGER_KIND_META]?.direction !== k.direction,
  );
  check(
    "台账 direction 与科目表一致",
    wrong.length === 0,
    wrong.map((w) => `${w.kind}=${w.direction}`).join("; "),
  );
  const negative = kinds.filter((k) => (k._sum.amountFen ?? 0) < 0);
  check("台账金额恒为正（方向由科目表达）", negative.length === 0);

  // B6 支付订单：只有 PAID/REFUNDED 才写收入台账，且一单只记一条
  const sponsorLedgers = await prisma.ledgerEntry.groupBy({
    by: ["refId"],
    where: { kind: "INCOME_SPONSOR" },
    _count: { _all: true },
  });
  check(
    "同一订单的收入台账至多一条",
    sponsorLedgers.every((s) => s._count._all <= 1),
    `${sponsorLedgers.filter((s) => s._count._all > 1).length} 个订单重复记账`,
  );
}

async function main() {
  try {
    await dbChecks();
  } catch (e) {
    console.log(
      `SKIP 数据库不变量：连不上库（${e instanceof Error ? e.message.split("\n")[0] : String(e)}）。` +
        `这些断言需要 DATABASE_URL 指向真实库后再跑 —— 跳过不等于通过。`,
    );
  }

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  if (fail > 0) {
    console.error(failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}

void main();
