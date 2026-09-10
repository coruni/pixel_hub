// IndexNow 密钥纯函数（无任何服务端依赖）：后台表单、密钥文件路由与推送层共用同一套规范判断。
// 规范：8~128 位，仅字母 / 数字 / 短横线；密钥必须同时出现在文件名（/{key}.txt）与文件内容中。
export const INDEXNOW_KEY_RE = /^[A-Za-z0-9-]{8,128}$/;

export function isValidIndexNowKey(key: string): boolean {
  return INDEXNOW_KEY_RE.test(key.trim());
}

/** 生成随机密钥（32 位十六进制）：密钥是公开信息，无需保密，但必须不可猜测以防他人冒用提交 */
export function newIndexNowKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
