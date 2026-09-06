// 上传限制 —— 服务端读取层（渲染 / action / 上传路由共用）。配置结构校验见 upload-config.ts。
import { cache } from "react";
import { prisma } from "@/lib/db/prisma";
import {
  DEFAULT_UPLOAD_LIMITS,
  UPLOAD_LIMITS_KEY,
  parseUploadLimits,
  serializeUploadLimits,
  type UploadLimits,
} from "@/lib/upload-config";

/** 读上传限制；未落库时返回代码内默认（不写库，绝不空白）。请求内去重（同请求多处共用） */
export const getUploadLimits = cache(async (): Promise<UploadLimits> => {
  const row = await prisma.siteSetting.findUnique({ where: { key: UPLOAD_LIMITS_KEY } });
  if (!row) return parseUploadLimits(null);
  let value: unknown = null;
  try {
    value = JSON.parse(row.value);
  } catch {
    value = null;
  }
  return parseUploadLimits(value);
});

/** 空表落库默认上传限制（后台 /admin/uploads 打开前调用），幂等 */
export async function ensureUploadLimits(): Promise<void> {
  const row = await prisma.siteSetting.findUnique({
    where: { key: UPLOAD_LIMITS_KEY },
    select: { key: true },
  });
  if (row) return;
  await prisma.siteSetting.create({
    data: { key: UPLOAD_LIMITS_KEY, value: serializeUploadLimits(DEFAULT_UPLOAD_LIMITS) },
  });
}

/** 限制文档 + 乐观锁版本（写回时版本不符即拒绝，防后台并发编辑互相覆盖） */
export type UploadLimitsDoc = { limits: UploadLimits; version: number };

export async function readUploadLimitsDoc(): Promise<UploadLimitsDoc> {
  const row = await prisma.siteSetting.findUnique({ where: { key: UPLOAD_LIMITS_KEY } });
  if (!row) return { limits: parseUploadLimits(null), version: 0 };
  let value: unknown = null;
  try {
    value = JSON.parse(row.value);
  } catch {
    value = null;
  }
  return { limits: parseUploadLimits(value), version: row.version };
}

/** 条件写回：版本匹配才落库并自增；返回 false = 有并发修改，调用方应提示刷新 */
export async function writeUploadLimitsDoc(doc: UploadLimitsDoc): Promise<boolean> {
  const value = serializeUploadLimits(doc.limits);
  const updated = await prisma.siteSetting.updateMany({
    where: { key: UPLOAD_LIMITS_KEY, version: doc.version },
    data: { value, version: { increment: 1 } },
  });
  if (updated.count === 1) return true;
  // 行不存在（从未保存过）：尝试首建，并发唯一键冲突则视为失败
  const created = await prisma.siteSetting
    .createMany({ data: { key: UPLOAD_LIMITS_KEY, value, version: 1 } })
    .catch(() => null);
  return !!created && created.count === 1;
}
