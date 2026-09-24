// 创作者激励配置 —— 纯数据/校验层（不依赖 server，可被前后端与脚本共用）。
// 文档存于 SiteSetting["incentive"]（JSON 文本），带 version 乐观锁（读写见 points.ts / actions/incentive.ts）。
//
// 【全局纪律】本文件是**全部阈值、比例、分值的唯一落点**。
// 业务模块（points.ts / download-record.ts / settle.ts / coin.ts）一律从配置读，
// 不许再写字面量默认值 —— 后台改完配置行为必须立即变化（验收项「反硬编码」）。
//
// 命名纪律（别混，混了口径就废）：
//   贡献分 = 荣誉层，只增不减，决定等级与结算权重；
//   PIX   = 资产层，会因提现/打赏减少；
//   元     = 结算层，只出现在提现页与后台。
//   「激励池 P」（本期应发额 = 收入 × 分成比例 + 上期结转）与「现金池 C」（站上真钱）也是两回事。

import { z } from "zod";
import type { CoinReason, PointReason } from "@prisma/client";

/** SiteSetting key：激励配置文档 */
export const INCENTIVE_KEY = "incentive";

/** 分/元换算：全链路金额以「分」为整数存储 */
export const FEN_PER_YUAN = 100;
/** 万分比基数：比例一律用整数万分比存储（3000 = 30%），避免浮点 */
export const PERMILLE_BASE = 10000;

// ---------- 分值默认（必须覆盖 Prisma 的 PointReason 全量） ----------
// `satisfies Record<PointReason, number>` 是编译期护栏：schema 增删枚举值时这里会立刻报错，
// 不会出现「加了新 reason 但忘记配分值 → 静默按 0 计分」。

const DEFAULT_SCORES = {
  PUBLISH: 20,
  LIKE_RECEIVED: 1,
  FAVORITE_RECEIVED: 5,
  DOWNLOAD_RECEIVED: 3,
  COMMENT_RECEIVED: 2,
  FOLLOWER_GAINED: 2,
  FEATURED: 50,
  DAILY_LOGIN: 0,
  ADMIN_ADJUST: 0,
} satisfies Record<PointReason, number>;

/** 【关键取舍】只有「难刷」的指标默认计入结算；点赞/评论/关注默认不计。
 *  否则刷分动机就从「虚荣」变成「偷钱」——见计划 §3.2、§5。 */
const DEFAULT_SETTLE_ELIGIBLE = {
  PUBLISH: true,
  LIKE_RECEIVED: false,
  FAVORITE_RECEIVED: true,
  DOWNLOAD_RECEIVED: true,
  COMMENT_RECEIVED: false,
  FOLLOWER_GAINED: false,
  FEATURED: true,
  DAILY_LOGIN: false,
  ADMIN_ADJUST: false,
} satisfies Record<PointReason, boolean>;

/** 分值的展示名（后台表单、贡献流水、等级进度页共用） */
export const POINT_REASON_LABELS = {
  PUBLISH: "投稿上架",
  LIKE_RECEIVED: "收到点赞",
  FAVORITE_RECEIVED: "被收藏",
  DOWNLOAD_RECEIVED: "被下载",
  COMMENT_RECEIVED: "收到评论",
  FOLLOWER_GAINED: "新增关注",
  FEATURED: "被精选",
  DAILY_LOGIN: "每日登录",
  ADMIN_ADJUST: "管理员调整",
} satisfies Record<PointReason, string>;

/** `PointReason` 全量列表（顺序即后台表单顺序） */
export const POINT_REASONS = Object.keys(DEFAULT_SCORES) as PointReason[];

export function pointReasonLabel(r: PointReason): string {
  return POINT_REASON_LABELS[r] ?? r;
}

// ---------- 代币流水原因 ----------
// 与 Prisma 的 CoinReason 全量对齐（`satisfies` 是编译期护栏：加了新枚举值这里会立刻报错）。

export const COIN_REASON_LABELS = {
  SETTLE: "激励结算入账",
  TIP_SENT: "打赏支出",
  TIP_RECEIVED: "收到打赏",
  WITHDRAW_FREEZE: "提现冻结",
  WITHDRAW_PAID: "提现完成",
  WITHDRAW_REFUND: "提现驳回解冻",
  ADMIN_ADJUST: "管理员调整",
} satisfies Record<CoinReason, string>;

export function coinReasonLabel(k: CoinReason): string {
  return COIN_REASON_LABELS[k] ?? k;
}

// ---------- 等级 ----------
// 等级**名称与门槛**可后台配置；**颜色不配置** —— Tailwind 只扫描源码里的字面量类名，
// 把类名塞进数据库等于让它编译不出来（与详情页模板 RAIL_* 常量同一条纪律）。
// 档位超过色板长度时循环取色。

export const LEVEL_BADGE_CLASSES = [
  "border-neutral-300 text-neutral-500",
  "border-brand-200 text-brand-700",
  "border-brand-300 text-brand-800",
  "border-brand-400 text-brand-900",
  "border-amber-300 text-amber-700",
  "border-red-300 text-red-600",
] as const;

export function levelBadgeClass(level: number): string {
  const i = Math.abs(level) % LEVEL_BADGE_CLASSES.length;
  return LEVEL_BADGE_CLASSES[i]!;
}

export const DEFAULT_LEVELS = [
  { name: "新人", min: 0 },
  { name: "创作者", min: 50 },
  { name: "资深创作者", min: 200 },
  { name: "优秀创作者", min: 600 },
  { name: "明星创作者", min: 2000 },
  { name: "殿堂创作者", min: 8000 },
] as const;

export type IncentiveLevel = { name: string; min: number };

/**
 * 贡献分 → 等级序号（0 起）。纯函数，前后端共用。
 * 门槛允许后台改乱（无序/重复），所以按 min 升序排序后再比，结果永远可解释。
 */
export function levelOf(points: number, levels: readonly IncentiveLevel[]): number {
  if (levels.length === 0) return 0;
  const sorted = [...levels].sort((a, b) => a.min - b.min);
  let lv = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (points >= sorted[i]!.min) lv = i;
    else break;
  }
  return lv;
}

export function levelNameOf(points: number, levels: readonly IncentiveLevel[]): string {
  const sorted = [...levels].sort((a, b) => a.min - b.min);
  return sorted[levelOf(points, sorted)]?.name ?? "新人";
}

/** 下一档所需总分；已封顶返回 null */
export function nextLevelAt(
  points: number,
  levels: readonly IncentiveLevel[],
): { name: string; min: number } | null {
  const sorted = [...levels].sort((a, b) => a.min - b.min);
  return sorted.find((l) => l.min > points) ?? null;
}

// ---------- zod schema ----------
// 每个叶子都带 .default()：整份配置缺失/坏掉时能逐字段回落到代码内默认，绝不抛错。

const intRange = (min: number, max: number) => z.number().int().min(min).max(max);

const scoresSchema = z.object({
  PUBLISH: intRange(0, 10000).default(DEFAULT_SCORES.PUBLISH),
  LIKE_RECEIVED: intRange(0, 10000).default(DEFAULT_SCORES.LIKE_RECEIVED),
  FAVORITE_RECEIVED: intRange(0, 10000).default(DEFAULT_SCORES.FAVORITE_RECEIVED),
  DOWNLOAD_RECEIVED: intRange(0, 10000).default(DEFAULT_SCORES.DOWNLOAD_RECEIVED),
  COMMENT_RECEIVED: intRange(0, 10000).default(DEFAULT_SCORES.COMMENT_RECEIVED),
  FOLLOWER_GAINED: intRange(0, 10000).default(DEFAULT_SCORES.FOLLOWER_GAINED),
  FEATURED: intRange(0, 10000).default(DEFAULT_SCORES.FEATURED),
  DAILY_LOGIN: intRange(0, 10000).default(DEFAULT_SCORES.DAILY_LOGIN),
  ADMIN_ADJUST: intRange(0, 10000).default(DEFAULT_SCORES.ADMIN_ADJUST),
});

const settleEligibleSchema = z.object({
  PUBLISH: z.boolean().default(DEFAULT_SETTLE_ELIGIBLE.PUBLISH),
  LIKE_RECEIVED: z.boolean().default(DEFAULT_SETTLE_ELIGIBLE.LIKE_RECEIVED),
  FAVORITE_RECEIVED: z.boolean().default(DEFAULT_SETTLE_ELIGIBLE.FAVORITE_RECEIVED),
  DOWNLOAD_RECEIVED: z.boolean().default(DEFAULT_SETTLE_ELIGIBLE.DOWNLOAD_RECEIVED),
  COMMENT_RECEIVED: z.boolean().default(DEFAULT_SETTLE_ELIGIBLE.COMMENT_RECEIVED),
  FOLLOWER_GAINED: z.boolean().default(DEFAULT_SETTLE_ELIGIBLE.FOLLOWER_GAINED),
  FEATURED: z.boolean().default(DEFAULT_SETTLE_ELIGIBLE.FEATURED),
  DAILY_LOGIN: z.boolean().default(DEFAULT_SETTLE_ELIGIBLE.DAILY_LOGIN),
  ADMIN_ADJUST: z.boolean().default(DEFAULT_SETTLE_ELIGIBLE.ADMIN_ADJUST),
});

const downloadSchema = z.object({
  /** 每主体每自然月的计分次数上限；0 = 不限制。**只停计分，绝不拦下载** */
  monthlyScoreCap: intRange(0, 100000).default(50),
  /** 单作品每月计分上限：默认关闭（会误伤热门作品，计划 §5.1） */
  perResourceCapEnabled: z.boolean().default(false),
  perResourceCap: intRange(1, 1000000).default(300),
  /** 匿名下载是否计入计分（下载量统计始终计入） */
  countAnonymous: z.boolean().default(true),
  /** 去重记录保留月数（机会式清理，避免表无限增长） */
  retainMonths: intRange(1, 120).default(13),
});

const coinSchema = z.object({
  name: z.string().trim().min(1).max(12).default("PIX"),
  symbol: z.string().trim().max(8).default("PIX"),
  /** 兑换比例：多少 PIX = 1 元 */
  perYuan: intRange(1, 100000).default(100),
});

const withdrawSchema = z.object({
  enabled: z.boolean().default(true),
  /** 提现门槛（PIX） */
  minCoin: intRange(1, 100000000).default(1000),
  /** 手续费（分），从提现金额中扣除；0 = 免手续费 */
  feeFen: intRange(0, 1000000).default(0),
  /** 两次提现之间的冷却天数 */
  cooldownDays: intRange(0, 365).default(7),
  /** 是否必须人工审核（默认是：系统绝不自动打款） */
  manualReview: z.boolean().default(true),
});

const tipSchema = z.object({
  enabled: z.boolean().default(true),
  minCoin: intRange(1, 1000000).default(1),
  maxCoin: intRange(1, 100000000).default(10000),
  /** 附言最大字数（0 = 不允许附言） */
  messageMax: intRange(0, 200).default(60),
  /** 公开打赏榜：默认关闭（打赏是私事，公开容易变成攀比场） */
  publicBoard: z.boolean().default(false),
});

const settlementSchema = z.object({
  /** 创作者分成比例（万分比）。**对毛收入切**，不是对利润切 —— 见计划 §3.1 的会计提示 */
  ratePermille: intRange(0, 10000).default(6000),
  /** 结算分门槛：低于门槛不参与分配（避免「发 0.03 元」的骚扰式结算） */
  minScore: intRange(0, 1000000).default(50),
  /** 最低发放额（分）：低于此额不发，转入下期池 */
  minPayoutFen: intRange(0, 100000000).default(500),
  /** 单人单期封顶（万分比，占池子比例） */
  capPermille: intRange(1, 10000).default(4000),
  /** 封顶溢出后的最大迭代轮数（超过则余款结转） */
  capIterations: intRange(1, 10).default(3),
  period: z.enum(["month"]).default("month"),
  // ---------- 自动结算 ----------
  // 字段平铺在 settlement 下（而不是再套一层 auto 对象）：后台表单的草稿机制按
  // 「组的直接子级」生成数值草稿（见 IncentiveManager 的 toDraft），套一层会让
  // 嵌套数值拿不到字符串草稿、编辑时无法中途清空。
  //
  // 【边界】自动只做到「确认入账」，打款永远人工 —— 计划 §13「系统绝不自动打款」。
  /** 默认关闭：开启前请确认收入录入节奏与回溯习惯，避免池子偏小后只能靠下期结转补 */
  autoEnabled: z.boolean().default(false),
  /** 归属月结束后第几天开始尝试（0 = 次月 1 日即可结） */
  autoDelayDays: intRange(0, 28).default(1),
  /** 每日尝试时点（本机时区 0–23 点）。到期后每天这个点试一次 */
  autoHour: intRange(0, 23).default(5),
  /** 上一轮失败后的最小重试间隔（小时）：资金不足是常态，不能每小时刷一次日志 */
  autoRetryHours: intRange(1, 72).default(6),
  /** 最多向前补跑几个月（含应结月）。停机数周后靠它追上进度 */
  autoMaxBackfillMonths: intRange(1, 36).default(12),
});

const solvencySchema = z.object({
  /** 安全水位 buffer（万分比）：要求 PIX 负债 ≤ 可用现金 × (1 − buffer) */
  bufferPermille: intRange(0, 5000).default(1000),
  /** 资金不足时的策略：拒绝（默认，推荐）/ 按可用资金等比缩减本次发放 */
  insufficientStrategy: z.enum(["reject", "scale"]).default("reject"),
});

const rankingSchema = z.object({
  periods: z.array(z.enum(["all", "month", "week"])).max(3).default(["all", "month", "week"]),
  limit: intRange(1, 100).default(50),
  /** 上榜最低等级（0 = 不限） */
  minLevel: intRange(0, 20).default(0),
});

const riskSchema = z.object({
  /** 冻结计分名单（只停计分，不影响任何正常功能） */
  frozenUserIds: z.array(z.string().min(1).max(64)).max(1000).default([]),
  /** 异常提示：单人占全站当期分值比例阈值（万分比），仅在后台提醒、不自动拦截 */
  anomalySharePermille: intRange(1, 10000).default(500),
  /** 异常提示：单期分值绝对增量阈值（分），低于此值不提示，避免噪声 */
  anomalyMinDelta: intRange(1, 100000000).default(500),
});

/** 公示页配置（对应 /fund，见计划 §8.1） */
const disclosureSchema = z.object({
  ledgerPageSize: intRange(5, 100).default(20),
  /** 是否展开逐笔金额明细（关掉只显示聚合总额） */
  showAmounts: z.boolean().default(true),
  /** 鸣谢墙是否公开单笔金额 */
  thanksShowAmount: z.boolean().default(false),
  allowAnonymous: z.boolean().default(true),
  /** 是否对外显示水位安全线 */
  showSafetyLine: z.boolean().default(true),
  cacheSeconds: intRange(0, 86400).default(300),
});

const levelsSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(20),
      min: intRange(0, 100000000),
    }),
  )
  .min(1)
  .max(LEVEL_BADGE_CLASSES.length)
  .default([...DEFAULT_LEVELS]);

export const incentiveSchema = z.object({
  /** 总开关：关闭后不计分、不展示等级与榜单（存量数据保留） */
  enabled: z.boolean().default(true),
  scores: scoresSchema,
  settleEligible: settleEligibleSchema,
  levels: levelsSchema,
  download: downloadSchema,
  coin: coinSchema,
  withdraw: withdrawSchema,
  tip: tipSchema,
  settlement: settlementSchema,
  solvency: solvencySchema,
  ranking: rankingSchema,
  risk: riskSchema,
  disclosure: disclosureSchema,
});

export type IncentiveConfig = z.infer<typeof incentiveSchema>;

/** 需要「缺失即补空对象」的字段组 —— 组内每个叶子都有 .default()，补 {} 即可整体回落默认 */
const GROUP_KEYS = [
  "scores",
  "settleEligible",
  "download",
  "coin",
  "withdraw",
  "tip",
  "settlement",
  "solvency",
  "ranking",
  "risk",
  "disclosure",
] as const;

function withGroupDefaults(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const k of GROUP_KEYS) {
    const v = out[k];
    if (v === null || typeof v !== "object" || Array.isArray(v)) out[k] = {};
  }
  return out;
}

/**
 * 从 SiteSetting JSON 解析为完整配置：坏数据/缺字段一律回落代码内默认，**绝不抛错**
 * （与 theme / uploadLimits 同范式：配置坏掉不能让全站页面 500）。
 * 返回值经 structuredClone 深拷贝 —— 避免调用方无意改到 zod `.default()` 的字面量引用。
 */
export function parseIncentive(raw: unknown): IncentiveConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const r = incentiveSchema.safeParse(withGroupDefaults(o));
  if (r.success) return structuredClone(r.data);
  // 兜底：全空输入必然成功（每个叶子都有默认值），失败说明 schema 自身有 bug
  return structuredClone(incentiveSchema.parse(withGroupDefaults({})));
}

export function serializeIncentive(c: IncentiveConfig): string {
  return JSON.stringify(c);
}

/**
 * 保存前校验后台提交的整份配置（与 safeHomeConfig / safeUploadLimits 同范式）。
 *
 * **语义：整份替换（WYSIWYG）** —— 后台表单永远提交完整文档，缺失的字段组按代码内默认补齐，
 * 缺失的叶子字段回落该字段默认值。所以调用方必须回传完整配置，不能只发被改的那几个字段。
 * 返回可读的第一条错误（带字段路径），供表单原地提示。
 */
export function safeIncentive(
  value: unknown,
): { ok: true; data: IncentiveConfig } | { ok: false; error: string } {
  const o = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const r = incentiveSchema.safeParse(withGroupDefaults(o));
  if (r.success) return { ok: true, data: structuredClone(r.data) };
  const issue = r.error.issues[0];
  const path = issue?.path.join(".");
  return { ok: false, error: `${path ? `${path}：` : ""}${issue?.message ?? "配置不合法"}` };
}

export const DEFAULT_INCENTIVE_CONFIG: IncentiveConfig = parseIncentive(null);

// ---------- 纯换算助手（前后端共用） ----------

/** PIX ↔ 元（分）换算；全整数运算，不引入浮点 */
export function coinToFen(coin: number, perYuan: number): number {
  if (perYuan <= 0) return 0;
  return Math.floor((coin * FEN_PER_YUAN) / perYuan);
}

export function fenToCoin(fen: number, perYuan: number): number {
  return Math.floor((fen * perYuan) / FEN_PER_YUAN);
}

/** 万分比取整（向下），用于「收入 × 分成比例」这类计算 */
export function applyPermille(value: number, permille: number): number {
  return Math.floor((value * permille) / PERMILLE_BASE);
}

/** 万分比展示：6000 → "60%"（去掉无意义的小数位） */
export function permilleText(permille: number): string {
  const pct = permille / (PERMILLE_BASE / 100);
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/**
 * 打赏预设档位：在 [minCoin, maxCoin] 之间按**等比**取 4 档（前后端共用，避免各处写死
 * 100/500/1000/2000 这类字面量 —— 后台一改范围，写死的档位就会出现在范围外）。
 * 区间退化（min ≥ max）时只给一个档位。
 */
export function tipPresets(minCoin: number, maxCoin: number, count = 4): number[] {
  const lo = Math.max(1, Math.trunc(minCoin));
  const hi = Math.max(lo, Math.trunc(maxCoin));
  if (hi <= lo) return [lo];
  const ratio = hi / lo;
  const out = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const v = Math.round(lo * Math.pow(ratio, i / (count - 1)));
    out.add(Math.min(hi, Math.max(lo, v)));
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 打赏面板参数。**「打赏作品」与「直接打赏作者」共用这一份形状** —— 两者 UI 完全一致，
 * 只差提交目标（TipRecord.resourceId 有没有值），所以参数不该各拼一遍。
 * 关闭激励体系或关闭打赏时返回 `undefined`：此时前台**完全不出入口**，不要渲染点了没反应的按钮。
 */
export type TipForm = {
  minCoin: number;
  maxCoin: number;
  presets: number[];
  symbol: string;
  messageMax: number;
};

export function tipFormOf(cfg: IncentiveConfig): TipForm | undefined {
  if (!cfg.enabled || !cfg.tip.enabled) return undefined;
  return {
    minCoin: cfg.tip.minCoin,
    maxCoin: cfg.tip.maxCoin,
    presets: tipPresets(cfg.tip.minCoin, cfg.tip.maxCoin),
    symbol: cfg.coin.symbol,
    messageMax: cfg.tip.messageMax,
  };
}
