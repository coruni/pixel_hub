// 注册邮箱验证码（H2/M2 修复）：集中式存储（Postgres RegisterCode 表），
// 多实例下签发与验证一致；DB 不可用（含迁移尚未执行）时透明回退内存，行为不回退。
// 10 分钟有效、最多 5 次尝试（防爆破）、验证成功或超限即销毁；进程重启丢码，用户重发即可，无需持久化。
// 生成用 crypto.randomInt（CSPRNG），不用 Math.random。
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { smtpConfigured } from "@/lib/mailer";

type CodeEntry = { code: string; expiresAt: number; attempts: number };

const TTL = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_KEYS = 2000; // 防内存膨胀：超限时先清过期，仍超限拒绝签发

const memStore = new Map<string, CodeEntry>(); // key: email（小写）

function memSweep(now: number): void {
  for (const [k, v] of memStore) if (v.expiresAt < now) memStore.delete(k);
}

function memIssue(email: string): string {
  const now = Date.now();
  memSweep(now);
  if (memStore.size >= MAX_KEYS) throw new Error("验证码签发繁忙，请稍后再试");
  const code = String(randomInt(100_000, 1_000_000)); // 6 位数字
  memStore.set(email, { code, expiresAt: now + TTL, attempts: 0 });
  return code;
}

function memVerify(
  email: string,
  code: string,
): { ok: true } | { ok: false; reason: "expired" | "attempts" | "mismatch" } {
  const e = memStore.get(email);
  if (!e || e.expiresAt < Date.now()) {
    memStore.delete(email);
    return { ok: false, reason: "expired" };
  }
  if (e.code !== code) {
    e.attempts += 1;
    if (e.attempts >= MAX_ATTEMPTS) {
      memStore.delete(email);
      return { ok: false, reason: "attempts" };
    }
    return { ok: false, reason: "mismatch" };
  }
  memStore.delete(email);
  return { ok: true };
}

/** 签发验证码（同邮箱重复签发覆盖旧码）；DB 异常时回退内存 */
export async function issueRegisterCode(email: string): Promise<string> {
  try {
    const code = String(randomInt(100_000, 1_000_000));
    const expiresAt = new Date(Date.now() + TTL);
    await prisma.registerCode.upsert({
      where: { email },
      create: { email, code, expiresAt, attempts: 0 },
      update: { code, expiresAt, attempts: 0 },
    });
    return code;
  } catch {
    return memIssue(email);
  }
}

/** 校验并消费：匹配成功、过期、超限均销毁；返回 false 附带原因供提示；DB 异常时回退内存 */
export async function verifyRegisterCode(
  email: string,
  code: string,
): Promise<{ ok: true } | { ok: false; reason: "expired" | "attempts" | "mismatch" }> {
  try {
    const e = await prisma.registerCode.findUnique({ where: { email } });
    if (!e || e.expiresAt < new Date()) {
      if (e) await prisma.registerCode.delete({ where: { email } });
      return { ok: false, reason: "expired" };
    }
    if (e.code !== code) {
      const attempts = e.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await prisma.registerCode.delete({ where: { email } });
        return { ok: false, reason: "attempts" };
      }
      await prisma.registerCode.update({ where: { email }, data: { attempts } });
      return { ok: false, reason: "mismatch" };
    }
    await prisma.registerCode.delete({ where: { email } });
    return { ok: true };
  } catch {
    return memVerify(email, code);
  }
}

/** 注册是否需要邮箱验证码：后台开关打开 且 SMTP 可用（无码可发时自动跳过，保底开箱即用） */
export async function emailCodeRequired(): Promise<boolean> {
  const c = await getRuntimeConfig();
  return c.emailCodeRequired === true && (await smtpConfigured());
}
