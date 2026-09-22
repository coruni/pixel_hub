// 支付配置 —— 服务端读写层（页面 / server action / 下单链路共用）。
// 结构校验与默认值见 payment-config.ts；本文件只管「从 SiteSetting 取出来 / 带乐观锁写回去」。
// 与 incentive.ts 完全同范式：读不到 / 读到坏数据 → 回代码内默认，**绝不抛错**。
//
// ⚠️ 本文件读出的配置含 `epay.key`。给前台/客户端一律走 `getPublicPaymentConfig()`
//    （它基于 publicPaymentConfig 投影，结构上不含密钥）。
import { cache } from "react";
import { prisma } from "@/lib/db/prisma";
import {
  PAYMENT_KEY,
  parsePaymentConfig,
  publicPaymentConfig,
  serializePaymentConfig,
  type PaymentConfig,
  type PublicPaymentConfig,
} from "@/lib/payment-config";

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 读支付配置（含密钥）。请求内去重。**只在服务端使用** */
export const getPaymentConfig = cache(async (): Promise<PaymentConfig> => {
  const row = await prisma.siteSetting.findUnique({ where: { key: PAYMENT_KEY } });
  return row ? parsePaymentConfig(safeJson(row.value)) : parsePaymentConfig(null);
});

/** 对外安全投影：结构上不含 pid / key / url。前台页面与 client 组件只能拿这个 */
export const getPublicPaymentConfig = cache(async (): Promise<PublicPaymentConfig> => {
  return publicPaymentConfig(await getPaymentConfig());
});

/** 空表落库默认配置（后台 /admin/payment 打开前调用），幂等 */
export async function ensurePaymentConfig(): Promise<void> {
  const row = await prisma.siteSetting.findUnique({
    where: { key: PAYMENT_KEY },
    select: { key: true },
  });
  if (row) return;
  await prisma.siteSetting.create({
    data: { key: PAYMENT_KEY, value: serializePaymentConfig(parsePaymentConfig(null)) },
  });
}

/** 配置文档 + 乐观锁版本 */
export type PaymentDoc = { config: PaymentConfig; version: number };

export async function readPaymentDoc(): Promise<PaymentDoc> {
  const row = await prisma.siteSetting.findUnique({ where: { key: PAYMENT_KEY } });
  if (!row) return { config: parsePaymentConfig(null), version: 0 };
  return { config: parsePaymentConfig(safeJson(row.value)), version: row.version };
}

/** 条件写回：版本匹配才落库并自增；返回 false = 有并发修改 */
export async function writePaymentDoc(doc: PaymentDoc): Promise<boolean> {
  const value = serializePaymentConfig(doc.config);
  const updated = await prisma.siteSetting.updateMany({
    where: { key: PAYMENT_KEY, version: doc.version },
    data: { value, version: { increment: 1 } },
  });
  if (updated.count === 1) return true;
  const created = await prisma.siteSetting
    .createMany({ data: { key: PAYMENT_KEY, value, version: 1 } })
    .catch(() => null);
  return !!created && created.count === 1;
}
