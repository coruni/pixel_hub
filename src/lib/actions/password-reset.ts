"use server";

import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { sendMail } from "@/lib/mailer";
import { renderMailHtml } from "@/lib/mail-template";
import { siteName } from "@/lib/site-url";
import { requestSiteUrl } from "@/lib/request-origin";

// ---------- 请求重置（忘记密码页） ----------

export type ForgotState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: { email?: string[] };
  previewLink?: string;
};

const forgotFields = z.object({ email: z.string().trim().toLowerCase().email("邮箱格式不正确") });

export async function requestPasswordResetAction(
  _prev: ForgotState,
  fd: FormData,
): Promise<ForgotState> {
  // 限流：每 IP 5 次 / 小时（防枚举与邮件轰炸）
  const ip = clientIp(await headers());
  if (!(await rateLimit(`pwreset:${ip}`, 5, 60 * 60_000))) return { error: "请求过于频繁，请稍后再试" };

  const parsed = forgotFields.safeParse({ email: String(fd.get("email") ?? "") });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  // 账号不存在也返回成功文案（防枚举）；真实用户才会生成 token 并发信
  if (!user) return { ok: true };

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 30 * 60_000) },
  });

  // 链接用"当前请求"的公网域名（CDN/反代兼容），勿回退到 .env 静态域名
  const link = `${await requestSiteUrl()}/reset-password?token=${token}`;
  const mail = await sendMail(
    parsed.data.email,
    `【${siteName()}】找回密码`,
    `你（或他人）正在用这个邮箱重置 ${siteName()} 账号的密码。\n\n打开下面的链接设置新密码（30 分钟内有效，仅可使用一次）：\n${link}\n\n如果这不是你的操作，请忽略本邮件。`,
    renderMailHtml({
      title: "找回密码",
      lines: [`你（或他人）正在用这个邮箱重置 ${siteName()} 账号的密码。`],
      linkUrl: link,
      linkText: "重置密码",
      note: "链接 30 分钟内有效，仅可使用一次；如按钮无法点击，可将链接复制到浏览器打开。如果这不是你的操作，请忽略本邮件。",
    }),
  );

  // 未配置 SMTP 的开发环境：把重置链接直接返回给页面，保证流程可联调
  return { ok: true, previewLink: mail.delivered ? undefined : mail.previewLink };
}

// ---------- 执行重置（重置页） ----------

export type ResetState = { error?: string; fieldErrors?: { password?: string[] } };

const resetFields = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "密码至少 8 位").max(72, "密码过长"),
});

export async function resetPasswordAction(_prev: ResetState, fd: FormData): Promise<ResetState> {
  const parsed = resetFields.safeParse({
    token: String(fd.get("token") ?? ""),
    password: String(fd.get("password") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!row || row.usedAt || row.expiresAt < new Date())
    return { error: "链接无效或已过期，请重新发起找回" };

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    // 该用户其余未用 token 一并作废 + 全部 session 踢下线（密码已换，旧会话不应存活）
    prisma.passwordResetToken.updateMany({
      where: { userId: row.userId, usedAt: null, id: { not: row.id } },
      data: { usedAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId: row.userId } }),
  ]);

  redirect("/login?reset=1");
}
