// 注册邮箱验证码：短 TTL 一次性数据，内存存储（与 rate-limit 同款部署假设：单实例长驻进程）。
// 10 分钟有效、最多 5 次尝试（防爆破）、验证成功或超限即销毁；进程重启丢码，用户重发即可，无需持久化。
// 生成用 crypto.randomInt（CSPRNG），不用 Math.random。
import { randomInt } from "node:crypto";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { smtpConfigured } from "@/lib/mailer";

type CodeEntry = { code: string; expiresAt: number; attempts: number };

const TTL = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_KEYS = 2000; // 防内存膨胀：超限时先清过期，仍超限拒绝签发

const store = new Map<string, CodeEntry>(); // key: email（小写）

function sweep(now: number): void {
  for (const [k, v] of store) if (v.expiresAt < now) store.delete(k);
}

/** 签发验证码（同邮箱重复签发覆盖旧码） */
export function issueRegisterCode(email: string): string {
  const now = Date.now();
  sweep(now);
  if (store.size >= MAX_KEYS) throw new Error("验证码签发繁忙，请稍后再试");
  const code = String(randomInt(100_000, 1_000_000)); // 6 位数字
  store.set(email, { code, expiresAt: now + TTL, attempts: 0 });
  return code;
}

/** 校验并消费：匹配成功、过期、超限均销毁；返回 false 附带原因供提示 */
export function verifyRegisterCode(
  email: string,
  code: string,
): { ok: true } | { ok: false; reason: "expired" | "attempts" | "mismatch" } {
  const e = store.get(email);
  if (!e || e.expiresAt < Date.now()) {
    store.delete(email);
    return { ok: false, reason: "expired" };
  }
  if (e.code !== code) {
    e.attempts += 1;
    if (e.attempts >= MAX_ATTEMPTS) {
      store.delete(email);
      return { ok: false, reason: "attempts" };
    }
    return { ok: false, reason: "mismatch" };
  }
  store.delete(email);
  return { ok: true };
}

/** 注册是否需要邮箱验证码：后台开关打开 且 SMTP 可用（无码可发时自动跳过，保底开箱即用） */
export async function emailCodeRequired(): Promise<boolean> {
  const c = await getRuntimeConfig();
  return c.emailCodeRequired === true && (await smtpConfigured());
}
