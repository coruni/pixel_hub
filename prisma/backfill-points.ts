// 存量贡献分回填（幂等，可反复重跑）——
// 把激励体系上线之前已有的「上架 / 点赞 / 收藏 / 评论 / 关注」补记成贡献分。
//
// 用法：
//   npx tsx prisma/backfill-points.ts            # 预演：只统计「将新增多少条 / 多少分」，不写库
//   npx tsx prisma/backfill-points.ts --apply    # 真正写库
//
// 为什么默认预演：本脚本会写 PointLog / UserPoint。生产库上先看一遍数字再决定，别一上来就写。
//
// 【幂等性】refId 与线上计分**完全同构**（interactionRefId / 资源 id），
// 唯一键 @@unique([userId, reason, refId]) 保证：重复跑、以及回填之后真实发生的动作，都不会重复计分。
// PUBLISH 线上由审核通过时以 actorId=管理员 写入；回填的 actorId=null，但 (userId, reason, refId) 相同，
// 所以「回填过 → 之后再审核一次资源」同样不会重复加分。
//
// 【无法回填的两类】历史数据里根本没有对应事实，硬造等于凭空发钱：
//   DOWNLOAD_RECEIVED —— 没有「谁在什么时候下过哪个作品」的历史（去重表是本体系才引入的）；
//   FEATURED          —— 没有「哪个资源曾被精选」的历史记录。
//
// 【口径一致性】分值/开关/冻结名单全部取自线上配置（getIncentive），自产自销判定复用 isSelfBenefit，
// 本脚本不自带任何阈值。
//
// 前置：环境变量 DATABASE_URL 必须指向目标库（与其它 prisma/*.ts 脚本一致，走 .env）。
import type { PointReason } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { getIncentive } from "../src/lib/incentive";
import { awardPoints, interactionRefId, isSelfBenefit, scoreOf } from "../src/lib/points";

const APPLY = process.argv.includes("--apply");
/** 回填覆盖的 reason（DOWNLOAD/FEATURED 无历史事实，见文件头） */
const REASONS: PointReason[] = [
  "PUBLISH",
  "LIKE_RECEIVED",
  "FAVORITE_RECEIVED",
  "COMMENT_RECEIVED",
  "FOLLOWER_GAINED",
];

/** 本脚本依赖的新表（属于 0006 迁移）。缺表时报可操作的错误，而不是甩一段 Prisma 堆栈 */
const REQUIRED_TABLES = ["UserPoint", "PointLog"];

async function preflight(): Promise<void> {
  const rows = await prisma.$queryRaw<{ relname: string }[]>`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN (${Prisma.join(REQUIRED_TABLES)})
  `;
  const have = new Set(rows.map((r) => r.relname));
  const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
  if (missing.length === 0) return;
  console.error(
    `[points:backfill] 目标库缺少表：${missing.join(" / ")}。\n` +
      "  请先执行迁移 prisma/migrations/0006_creator_incentive.sql（幂等，可重复执行），再跑本脚本。",
  );
  process.exit(1);
}

type Ev = {
  /** 事件时间（毫秒），用于让流水顺序与真实发生顺序一致 */
  ts: number;
  /** 得分人 */
  userId: string;
  /** 触发者；null = 系统（上架回填没有具体管理员） */
  actorId: string | null;
  reason: PointReason;
  refId: string;
};

async function collect(): Promise<Ev[]> {
  const out: Ev[] = [];

  const resources = await prisma.resource.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, authorId: true, publishedAt: true, createdAt: true },
  });
  for (const r of resources) {
    out.push({
      ts: (r.publishedAt ?? r.createdAt).getTime(),
      userId: r.authorId,
      actorId: null,
      reason: "PUBLISH",
      refId: r.id,
    });
  }

  const likes = await prisma.like.findMany({
    select: {
      userId: true,
      resourceId: true,
      createdAt: true,
      resource: { select: { authorId: true } },
    },
  });
  for (const l of likes) {
    out.push({
      ts: l.createdAt.getTime(),
      userId: l.resource.authorId,
      actorId: l.userId,
      reason: "LIKE_RECEIVED",
      refId: interactionRefId("like", l.userId, l.resourceId),
    });
  }

  const favorites = await prisma.favorite.findMany({
    select: {
      userId: true,
      resourceId: true,
      createdAt: true,
      resource: { select: { authorId: true } },
    },
  });
  for (const f of favorites) {
    out.push({
      ts: f.createdAt.getTime(),
      userId: f.resource.authorId,
      actorId: f.userId,
      reason: "FAVORITE_RECEIVED",
      refId: interactionRefId("fav", f.userId, f.resourceId),
    });
  }

  // 全部评论（含已隐藏/待审的）：线上是「插入即计分」，不因事后状态变化回冲，回填保持同一口径
  const comments = await prisma.comment.findMany({
    select: {
      authorId: true,
      resourceId: true,
      createdAt: true,
      resource: { select: { authorId: true } },
    },
  });
  for (const c of comments) {
    out.push({
      ts: c.createdAt.getTime(),
      userId: c.resource.authorId,
      actorId: c.authorId,
      reason: "COMMENT_RECEIVED",
      refId: interactionRefId("cmt", c.authorId, c.resourceId),
    });
  }

  const follows = await prisma.follow.findMany({
    select: { followerId: true, followingId: true, createdAt: true },
  });
  for (const f of follows) {
    out.push({
      ts: f.createdAt.getTime(),
      userId: f.followingId,
      actorId: f.followerId,
      reason: "FOLLOWER_GAINED",
      refId: interactionRefId("flw", f.followerId, f.followingId),
    });
  }

  // 同刻事件用 refId 兜底排序，保证每次跑的写入顺序完全一致（可复现）
  return out.sort((a, b) => a.ts - b.ts || (a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0));
}

async function main(): Promise<void> {
  await preflight();

  const cfg = await getIncentive();
  if (!cfg.enabled) {
    console.error("[points:backfill] 激励总开关处于关闭状态，先到 /admin/incentive 打开再回填。");
    process.exit(1);
  }

  console.log(`[points:backfill] 开始收集存量事件…（${APPLY ? "写库模式" : "预演模式"}）`);
  const events = await collect();
  console.log(`[points:backfill] 收集到 ${events.length} 条候选事件`);

  const banned = new Set(
    (
      await prisma.user.findMany({
        where: { bannedAt: { not: null } },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
  const frozen = new Set(cfg.risk.frozenUserIds);

  // 已存在的幂等键：用来在预演阶段就能给出准确数字（而不是只报上限）
  const existing = new Set<string>();
  for (const l of await prisma.pointLog.findMany({
    where: { reason: { in: REASONS } },
    select: { userId: true, reason: true, refId: true },
  })) {
    existing.add(`${l.reason}|${l.refId}|${l.userId}`);
  }

  const stat = new Map<
    PointReason,
    { add: number; points: number; done: number; self: number; off: number; zero: number }
  >();
  for (const r of REASONS) {
    stat.set(r, { add: 0, points: 0, done: 0, self: 0, off: 0, zero: 0 });
  }

  const todo: Ev[] = [];
  let done = 0;
  for (const e of events) {
    const s = stat.get(e.reason)!;
    const delta = scoreOf(cfg, e.reason);
    if (existing.has(`${e.reason}|${e.refId}|${e.userId}`)) {
      s.done += 1;
      continue;
    }
    if (delta === 0) {
      s.zero += 1;
      continue;
    }
    if (isSelfBenefit(e.reason, e.actorId, e.userId)) {
      s.self += 1;
      continue;
    }
    if (banned.has(e.userId) || frozen.has(e.userId)) {
      s.off += 1;
      continue;
    }
    s.add += 1;
    s.points += delta;
    todo.push(e);
  }

  console.log("\n[points:backfill] 统计（reason / 将新增 / 预计分值 / 已计过 / 自产自销 / 封禁或冻结 / 分值为0）");
  let totalAdd = 0;
  let totalPoints = 0;
  for (const r of REASONS) {
    const s = stat.get(r)!;
    totalAdd += s.add;
    totalPoints += s.points;
    console.log(
      `  ${r.padEnd(18)} ${String(s.add).padStart(7)} ${String(s.points).padStart(9)} ${String(s.done).padStart(7)} ${String(s.self).padStart(7)} ${String(s.off).padStart(8)} ${String(s.zero).padStart(8)}`,
    );
  }
  console.log(`  合计：新增 ${totalAdd} 条 / ${totalPoints} 分`);

  if (!APPLY) {
    console.log("\n[points:backfill] 预演结束，未写库。确认数字无误后加 --apply 执行。");
    return;
  }

  console.log("\n[points:backfill] 开始写库…");
  let written = 0;
  for (const e of todo) {
    // awardPoints 内部会重新校验开关/冻结/自产自销，并靠唯一键兜住并发重复
    const ok = await awardPoints({
      userId: e.userId,
      actorId: e.actorId,
      reason: e.reason,
      refId: e.refId,
      note: "存量回填",
    });
    if (ok) written += 1;
    done += 1;
    if (done % 200 === 0) console.log(`[points:backfill] 已处理 ${done}/${todo.length}，写入 ${written}`);
  }
  console.log(`[points:backfill] 完成：写入 ${written} 条（目标 ${todo.length} 条）`);
  if (written < todo.length) {
    console.log(
      "[points:backfill] 差额说明：并发写入、或期间账号被封禁/冻结，都会让部分条目被规则拦下（属预期）。",
    );
  }
}

main()
  .catch((e) => {
    console.error("[points:backfill] 失败：", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
