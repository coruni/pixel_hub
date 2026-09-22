// 创作者激励配置 —— 服务端读写层（页面 / server action / 计分引擎共用）。
// 结构校验与默认值见 points-config.ts；本文件只管「从 SiteSetting 取出来 / 带乐观锁写回去」。
// 与 theme（site.ts + site-config.ts）、uploadLimits（upload-limits.ts + upload-config.ts）同范式：
// 读不到 / 读到坏数据 → 回代码内默认，**绝不抛错**（配置坏掉不能让全站页面 500）。
import { cache } from "react";
import { prisma } from "@/lib/db/prisma";
import {
  INCENTIVE_KEY,
  parseIncentive,
  serializeIncentive,
  type IncentiveConfig,
} from "@/lib/points-config";

/** 读激励配置；未落库时返回代码内默认（不写库）。请求内去重（page 与 sidebar 共用） */
export const getIncentive = cache(async (): Promise<IncentiveConfig> => {
  const row = await prisma.siteSetting.findUnique({ where: { key: INCENTIVE_KEY } });
  if (!row) return parseIncentive(null);
  let value: unknown = null;
  try {
    value = JSON.parse(row.value);
  } catch {
    value = null;
  }
  return parseIncentive(value);
});

/** 激励总开关：关掉后不计分、不展示等级与榜单（存量数据保留）。计分热路径只读这一个布尔 */
export async function incentiveEnabled(): Promise<boolean> {
  return (await getIncentive()).enabled;
}

/** 空表落库默认配置（后台 /admin/incentive 打开前调用），幂等 */
export async function ensureIncentive(): Promise<void> {
  const row = await prisma.siteSetting.findUnique({
    where: { key: INCENTIVE_KEY },
    select: { key: true },
  });
  if (row) return;
  await prisma.siteSetting.create({
    data: { key: INCENTIVE_KEY, value: serializeIncentive(parseIncentive(null)) },
  });
}

/** 配置文档 + 乐观锁版本（写回时版本不符即拒绝，防后台并发编辑互相覆盖） */
export type IncentiveDoc = { config: IncentiveConfig; version: number };

export async function readIncentiveDoc(): Promise<IncentiveDoc> {
  const row = await prisma.siteSetting.findUnique({ where: { key: INCENTIVE_KEY } });
  if (!row) return { config: parseIncentive(null), version: 0 };
  let value: unknown = null;
  try {
    value = JSON.parse(row.value);
  } catch {
    value = null;
  }
  return { config: parseIncentive(value), version: row.version };
}

/** 条件写回：版本匹配才落库并自增；返回 false = 有并发修改，调用方应提示刷新 */
export async function writeIncentiveDoc(doc: IncentiveDoc): Promise<boolean> {
  const value = serializeIncentive(doc.config);
  const updated = await prisma.siteSetting.updateMany({
    where: { key: INCENTIVE_KEY, version: doc.version },
    data: { value, version: { increment: 1 } },
  });
  if (updated.count === 1) return true;
  // 行不存在（从未保存过）：尝试首建，并发唯一键冲突则视为失败
  const created = await prisma.siteSetting
    .createMany({ data: { key: INCENTIVE_KEY, value, version: 1 } })
    .catch(() => null);
  return !!created && created.count === 1;
}
