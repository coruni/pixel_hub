// 多桶配置的共享工具：运行时校验（runtime-config 的 zod schema）与后台表单（客户端组件）
// 必须用同一个上限，否则表单能加出被 schema 静默截断的行；容量上限的 GB↔字节换算与展示格式化
// 也放这里，理由相同 —— 服务端判「装不装得下」和界面显示必须是同一套算术。
// 本文件刻意不引任何服务端依赖（prisma / node:*），"use client" 组件可以安全 import。
export const S3_MAX_EXTRA_BUCKETS = 8;

const GB_BYTES = 1024 ** 3;

/** 「容量上限（GB）」字符串 → 字节（0 = 不限）。非法 / 非正一律当不限 */
export function gbToBytes(v: string): number {
  const n = Number(v.trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * GB_BYTES);
}

/** 容量上限是否「填了但不合法」：保存时要拦下来，不然静默降级成「不限」等于没有防线 */
export function isInvalidGb(v: string): boolean {
  return v.trim() !== "" && gbToBytes(v) === 0;
}

/** 字节数 → 人类可读（最多一位小数）：后台用量展示与容量预检的错误信息共用 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? v : Math.round(v * 10) / 10} ${units[i]}`;
}
