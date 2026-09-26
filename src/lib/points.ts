// 贡献分（荣誉层）—— 计分引擎与读侧。
//
// 【唯一写入口】全站贡献分只允许经 `awardPoints()` 写入。
// 事实来源是 `PointLog`；`UserPoint.balance` 是它的物化余额（可随时重算对账）。
//
// 【三条不变量】
//   1. 累计获得不回冲 —— 取消点赞不产生负向记录（`delta` 只在管理员调整时为负）。
//   2. 幂等 —— `@@unique([userId, reason, refId])` 是最后一道闸门；重复触发只留一条流水。
//   3. 计分失败不拖主流程 —— awardPoints 内部吞掉所有异常，只留 `[points]` 日志。
//
// 数值一律来自 points-config.ts（后台可配），本文件不出现任何阈值字面量。
import { Prisma } from "@prisma/client";
import type { PointReason } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getIncentive } from "@/lib/incentive";
import { levelOf, type IncentiveConfig } from "@/lib/points-config";

/**
 * 「自产自销」必须拦截的 reason：这类分是「别人对我的内容做了动作」的奖励，
 * 自己给自己刷不该有收益。
 * 反过来 PUBLISH（投稿奖励）/ FEATURED（精选）/ ADMIN_ADJUST（人工调整）/ DAILY_LOGIN（本人行为）
 * 的 actor 本来就是本人或管理员，**不能**按自产自销拦截 —— 这条区分是刻意的。
 */
const NO_SELF_BENEFIT: ReadonlySet<PointReason> = new Set<PointReason>([
  "LIKE_RECEIVED",
  "FAVORITE_RECEIVED",
  "DOWNLOAD_RECEIVED",
  "COMMENT_RECEIVED",
  "FOLLOWER_GAINED",
]);

/**
 * 「他人行为」类计分的幂等键构造器。
 *
 * **为什么要把触发者编进 refId**：唯一约束是 `(userId, reason, refId)`，其中 userId 是**得分人**
 * （内容作者）。若 refId 只写目标 id（如资源 id），那么全站对同一作品永远只加一次分 ——
 * 第 2 个点赞的人、第 2 个下载的人都不产生任何分值，「收到点赞」这个指标就废了。
 * 把触发者编进去后：**每个触发者对同一目标恰好贡献一次分**，反复 like/unlike 也不会重复加。
 * 这与计划 §5.1 对下载定义的 `dl:<subjectKey>:<resourceId>` 是同一套口径。
 *
 * 匿名触发者（理论上下载才可能）统一落 `anon`，与 `ip:<ipHash>` 主体键区分开。
 */
export function interactionRefId(
  kind: "like" | "fav" | "cmt" | "flw",
  actorId: string | null,
  targetId: string,
): string {
  return `${kind}:${actorId ?? "anon"}:${targetId}`;
}

export type AwardInput = {
  /** 得分人（内容作者 / 被关注者 / 本人） */
  userId: string;
  /** 触发者：点赞人 / 下载人 / 审核人 / 管理员。缺省表示系统行为 */
  actorId?: string | null;
  reason: PointReason;
  /**
   * 幂等键。语义约定（与计划 §5 一致）：
   *   LIKE_RECEIVED / FAVORITE_RECEIVED / COMMENT_RECEIVED / FOLLOWER_GAINED → 资源 id / 关注者 id
   *   DOWNLOAD_RECEIVED → `dl:<subjectKey>:<resourceId>`（由 download-record 提供）
   *   PUBLISH / FEATURED → 资源 id
   *   ADMIN_ADJUST → null（唯一索引不约束 NULL，可反复调整）
   */
  refId: string | null;
  /** 覆盖分值（不传则取配置里该 reason 的分值） */
  delta?: number;
  note?: string;
  /**
   * 跳过冻结名单拦截。**只给管理员人工调整用**：冻结名单的目的是「停住自动化计分」，
   * 而人工调整本来就是人在做判断 —— 若这里也被冻结挡住，管理员就没法对冻结账号做任何修正
   * （包括扣掉刷出来的分）。
   */
  bypassFrozen?: boolean;
};

/** 该 reason 在当前配置下的分值 */
export function scoreOf(cfg: IncentiveConfig, reason: PointReason): number {
  return cfg.scores[reason] ?? 0;
}

/** 该 reason 是否计入结算（决定它是否参与激励池分配） */
export function isSettleEligible(cfg: IncentiveConfig, reason: PointReason): boolean {
  return cfg.settleEligible[reason] === true;
}

/**
 * 是否为「自己给自己刷」——触发者就是得分人，且该 reason 属于必须拦截的那类。
 * 与 awardPoints 内部判定共用同一份规则（回填脚本等外部调用方也走这里，避免两套口径）。
 */
export function isSelfBenefit(
  reason: PointReason,
  actorId: string | null,
  userId: string,
): boolean {
  return !!actorId && actorId === userId && NO_SELF_BENEFIT.has(reason);
}

function isFrozen(cfg: IncentiveConfig, userId: string): boolean {
  return cfg.risk.frozenUserIds.includes(userId);
}

/**
 * 记一笔贡献分。返回 true = 真的记上了（可用于测试断言）；false = 被规则拦下或已计过。
 * **永不抛错** —— 计分是附加收益，不能让它把点赞/评论/下载主流程带崩。
 */
export async function awardPoints(input: AwardInput): Promise<boolean> {
  try {
    const cfg = await getIncentive();
    if (!cfg.enabled) return false;
    if (!input.bypassFrozen && isFrozen(cfg, input.userId)) return false;

    const actor = input.actorId ?? null;
    if (isSelfBenefit(input.reason, actor, input.userId)) return false;

    const delta = input.delta ?? scoreOf(cfg, input.reason);
    // 分值为 0 = 该原因当前不产出贡献分（如默认的 DAILY_LOGIN）：不写流水，避免刷屏
    if (delta === 0) return false;

    await prisma.$transaction(async (tx) => {
      // 确保账户行存在（首次计分的人还没被回填过）
      await tx.userPoint.upsert({ where: { userId: input.userId }, create: { userId: input.userId }, update: {} });
      const after = await tx.userPoint.update({
        where: { userId: input.userId },
        data: { balance: { increment: delta } },
        select: { balance: true, level: true },
      });
      // 先写流水：唯一键冲突会让整个事务回滚，余额自增也随之撤销 —— 幂等的关键
      await tx.pointLog.create({
        data: {
          userId: input.userId,
          actorId: actor,
          reason: input.reason,
          refId: input.refId,
          delta,
          balance: after.balance,
          note: input.note ?? null,
        },
      });
      const lv = levelOf(after.balance, cfg.levels);
      if (lv !== after.level) {
        await tx.userPoint.update({ where: { userId: input.userId }, data: { level: lv } });
      }
    });
    return true;
  } catch (e) {
    // P2002 = 同一 (userId, reason, refId) 已计过分：并发重复触发，属预期，静默
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    console.error(`[points] award 失败 reason=${input.reason} userId=${input.userId}`, e);
    return false;
  }
}

// ---------- 读侧 ----------

/**
 * 只取贡献分余额。等级名称**不读 `UserPoint.level` 冗余列** —— 后台一改档位门槛它就过期，
 * 一律由 `levelOf(balance, cfg.levels)` 现算（与计划 §7「level 仅作冗余排序列」一致）。
 * 单独一个查询而不是塞进 queries.ts 的 getProfile：那个文件已 1354 行，不再往上堆。
 */
export async function getPointBalance(userId: string): Promise<number> {
  const row = await prisma.userPoint.findUnique({
    where: { userId },
    select: { balance: true },
  });
  return row?.balance ?? 0;
}

export type PointLogRow = {
  id: string;
  reason: PointReason;
  delta: number;
  balance: number;
  note: string | null;
  createdAt: Date;
};

export async function getPointLogs(userId: string, take: number): Promise<PointLogRow[]> {
  const rows = await prisma.pointLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, reason: true, delta: true, balance: true, note: true, createdAt: true },
  });
  // reason 在库里是枚举，读出来必然是合法值；显式断言避免 as 散落
  return rows.map((r) => ({ ...r, reason: r.reason as PointReason }));
}

export type ContributionSummary = {
  /** 当前贡献分（无记录时为 0） */
  points: number;
  level: number;
  levelName: string;
  next: { name: string; min: number } | null;
  /** 距下一档还差多少分；已封顶为 0 */
  toNext: number;
  /** 下一档进度 0..1；已封顶为 1 */
  progress: number;
  frozen: boolean;
};

export async function getContributionSummary(userId: string): Promise<ContributionSummary> {
  const cfg = await getIncentive();
  const row = await prisma.userPoint.findUnique({
    where: { userId },
    select: { balance: true },
  });
  const points = row?.balance ?? 0;
  const sorted = [...cfg.levels].sort((a, b) => a.min - b.min);
  const level = levelOf(points, sorted);
  const next = sorted.find((l) => l.min > points) ?? null;
  const curMin = sorted[level]?.min ?? 0;
  const span = next ? next.min - curMin : 0;
  return {
    points,
    level,
    levelName: sorted[level]?.name ?? "新人",
    next,
    toNext: next ? next.min - points : 0,
    progress: next ? Math.min(1, Math.max(0, (points - curMin) / span)) : 1,
    // 冻结状态**只看配置这一个来源**（UserPoint 已无 frozen 列）—— 与 awardPoints 的拦截口径同源
    frozen: isFrozen(cfg, userId),
  };
}

/** 榜单周期口径：all = 累计（与结算口径一致）；month/week = **滚动窗口**（近 30 / 7 天）。
 *  刻意不用自然周/自然月做荣誉榜 —— 月底月初会出现「全员归零」的观感问题，
 *  结算期才需要自然月（那由 IncentivePeriod 单独负责）。 */
export type RankPeriod = "all" | "month" | "week";

const ROLLING_DAYS: Record<Exclude<RankPeriod, "all">, number> = { month: 30, week: 7 };

export function periodSince(period: RankPeriod, now = new Date()): Date | null {
  if (period === "all") return null;
  return new Date(now.getTime() - ROLLING_DAYS[period] * 86400_000);
}

export type RankedCreator = {
  userId: string;
  username: string;
  name: string | null;
  /** 昵称特效色 key（User.nameColor）；渲染走 components/ui/Nickname */
  nameColor: string | null;
  avatarKey: string | null;
  /** 该周期内的贡献分（all 时为累计余额） */
  points: number;
  level: number;
};

/**
 * 按贡献分取榜单。只取「贡献分」，**不取 PIX** —— 荣誉榜不能变成财富榜（计划 §7）。
 * 已封禁用户不上榜（与首页 creators 板块口径一致）。
 */
export async function getTopByPoints(period: RankPeriod, limit: number): Promise<RankedCreator[]> {
  const cfg = await getIncentive();
  if (!cfg.enabled) return [];
  const minLevel = cfg.ranking.minLevel;
  const since = periodSince(period);

  if (!since) {
    const rows = await prisma.userPoint.findMany({
      where: { user: { bannedAt: null }, level: { gte: minLevel } },
      orderBy: [{ balance: "desc" }, { userId: "asc" }],
      take: limit,
      select: {
        userId: true,
        balance: true,
        level: true,
        user: { select: { username: true, name: true, nameColor: true, avatarKey: true } },
      },
    });
    return rows.map((r) => ({
      userId: r.userId,
      username: r.user.username,
      name: r.user.name,
      nameColor: r.user.nameColor,
      avatarKey: r.user.avatarKey,
      points: r.balance,
      level: r.level,
    }));
  }

  // 滚动窗口：按流水聚合，再补用户展示信息（两步是为了让聚合走索引、不 join 全表）
  const grouped = await prisma.pointLog.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: since }, delta: { gt: 0 } },
    _sum: { delta: true },
    orderBy: [{ _sum: { delta: "desc" } }, { userId: "asc" }],
    take: limit * 3, // 多取一些，过滤封禁/等级后在内存里截断
  });
  if (grouped.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.userId) }, bannedAt: null },
    select: {
      id: true,
      username: true,
      name: true,
      nameColor: true,
      avatarKey: true,
      points: { select: { level: true } },
    },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const out: RankedCreator[] = [];
  for (const g of grouped) {
    const u = byId.get(g.userId);
    if (!u) continue;
    const level = u.points?.level ?? 0;
    if (level < minLevel) continue;
    out.push({
      userId: g.userId,
      username: u.username,
      name: u.name,
      nameColor: u.nameColor,
      avatarKey: u.avatarKey,
      points: g._sum.delta ?? 0,
      level,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** 我在该周期内的名次（1 起）。无流水/未上榜返回 null */
export async function getPointRank(userId: string, period: RankPeriod): Promise<number | null> {
  const since = periodSince(period);
  if (!since) {
    const me = await prisma.userPoint.findUnique({ where: { userId }, select: { balance: true } });
    if (!me) return null;
    const ahead = await prisma.userPoint.count({
      where: { balance: { gt: me.balance }, user: { bannedAt: null } },
    });
    return ahead + 1;
  }
  const mine = await prisma.pointLog.aggregate({
    where: { userId, createdAt: { gte: since }, delta: { gt: 0 } },
    _sum: { delta: true },
  });
  const mySum = mine._sum.delta ?? 0;
  if (mySum <= 0) return null;
  const grouped = await prisma.pointLog.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: since }, delta: { gt: 0 } },
    _sum: { delta: true },
  });
  const ahead = grouped.filter((g) => (g._sum.delta ?? 0) > mySum).length;
  return ahead + 1;
}
