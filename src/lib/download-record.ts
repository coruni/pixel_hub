// 下载记录 —— 同一张表同时承担「下载量去重」与「计分去重」。
//
// 【为什么不用 cookie】原先靠 `dl_done` cookie 去重：清一下 cookie、换个浏览器、开无痕，
// 同一个人就能反复刷下载量。下载量是结算分的重要来源，cookie 级去重等于把激励池敞开。
//
// 【两道闸门】
//   1. 主体级去重：`@@unique([resourceId, subjectKey])`。subjectKey = 登录 `u:<userId>` /
//      匿名 `ip:<ipHash>`。同一主体对同一作品**永远只算一次**（登录用户换 IP 也没用）。
//   2. 月度配额：每主体每自然月默认 50 次计分（后台可配）。**超配额只停计分，绝不拦下载** ——
//      配额是反刷手段，不是限流手段，不能变成对付费/正常用户的限制。
//
// 单作品月度上限默认**关闭**：热门作品的下载天然集中在少数几件上，硬压会误伤真实热度，
// 所以默认只作为后台异常提示的依据。
//
// 阈值全部来自 points-config.ts（后台可配），本文件不出现任何字面量。
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { monthKey } from "@/lib/format";
import { subjectKeyFor } from "@/lib/ip";
import { getIncentive } from "@/lib/incentive";
import type { IncentiveConfig } from "@/lib/points-config";

export type RecordDownloadInput = {
  resourceId: string;
  /** 已登录用户 id；匿名为 null */
  userId: string | null;
  ipHash: string;
};

export type RecordDownloadResult = {
  /** 是否首次：true 表示本次应给 `Resource.downloadCount` +1 */
  firstTime: boolean;
  /** 是否通过计分闸门：false 时**下载照常**，只是不给作者贡献分 */
  counted: boolean;
  /** 本次使用的幂等键（计分用）；未计分时为 null */
  refId: string | null;
};

/** 月度配额与单作品上限判定 —— 只决定「给不给分」，与能否下载无关 */
async function passesScoreGate(
  cfg: IncentiveConfig,
  subjectKey: string,
  resourceId: string,
  periodKey: string,
): Promise<boolean> {
  const monthlyCap = cfg.download.monthlyScoreCap;
  if (monthlyCap > 0) {
    const used = await prisma.downloadRecord.count({
      where: { subjectKey, periodKey, counted: true },
    });
    if (used >= monthlyCap) return false;
  }
  if (cfg.download.perResourceCapEnabled) {
    const usedOnResource = await prisma.downloadRecord.count({
      where: { resourceId, periodKey, counted: true },
    });
    if (usedOnResource >= cfg.download.perResourceCap) return false;
  }
  return true;
}

/** 机会式清理：约 1% 的请求顺带删掉超过保留期的记录，免去定时任务（与 Visit 同一策略） */
function sweepOldRecords(cfg: IncentiveConfig): void {
  if (Math.random() >= 0.01) return;
  const keepMs = cfg.download.retainMonths * 31 * 86400_000;
  const cutoff = new Date(Date.now() - keepMs);
  void prisma.downloadRecord
    .deleteMany({ where: { createdAt: { lt: cutoff } } })
    .catch((e) => console.error("[download-record] sweep 失败", e));
}

/**
 * 记一次下载。并发安全：靠唯一键兜住「同一主体同时点两次」。
 * 调用方拿到 `firstTime` 后再自增 `Resource.downloadCount`，拿到 `counted` 后再走计分。
 */
export async function recordDownload(input: RecordDownloadInput): Promise<RecordDownloadResult> {
  const cfg = await getIncentive();
  const subjectKey = subjectKeyFor(input.userId, input.ipHash);
  const periodKey = monthKey(new Date());

  // 快速路径：已下载过（命中唯一键）→ 什么都不做
  const existing = await prisma.downloadRecord.findUnique({
    where: { resourceId_subjectKey: { resourceId: input.resourceId, subjectKey } },
    select: { id: true },
  });
  if (existing) return { firstTime: false, counted: false, refId: null };

  const anonymousBlocked = !input.userId && !cfg.download.countAnonymous;
  const counted =
    cfg.enabled && !anonymousBlocked
      ? await passesScoreGate(cfg, subjectKey, input.resourceId, periodKey)
      : false;

  try {
    await prisma.downloadRecord.create({
      data: {
        resourceId: input.resourceId,
        subjectKey,
        userId: input.userId,
        ipHash: input.ipHash,
        periodKey,
        counted,
      },
    });
  } catch (e) {
    // 并发：另一请求刚插入同一 (resourceId, subjectKey) → 视为重复，不重复计数
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { firstTime: false, counted: false, refId: null };
    throw e;
  }

  sweepOldRecords(cfg);

  return {
    firstTime: true,
    counted,
    refId: counted ? downloadRefId(subjectKey, input.resourceId) : null,
  };
}

/** 计分幂等键：把「谁下载的」编进去，作者才能按不同下载者各得一次分 */
export function downloadRefId(subjectKey: string, resourceId: string): string {
  return `dl:${subjectKey}:${resourceId}`;
}

/** 某主体本月已计分的下载次数（后台排查用） */
export async function monthlyScoredCount(subjectKey: string): Promise<number> {
  return prisma.downloadRecord.count({
    where: { subjectKey, periodKey: monthKey(new Date()), counted: true },
  });
}
