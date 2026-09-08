"use server";

// 注册邮箱验证码发送：IP 每小时 10 次 + 单邮箱每分钟 1 次（防邮件轰炸）；已注册邮箱直接拒绝。
// 验证码本体只进内存与邮件正文，不落库不进日志。
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { sendMail, smtpConfigured } from "@/lib/mailer";
import { renderMailHtml } from "@/lib/mail-template";
import { issueRegisterCode } from "@/lib/register-code";
import { siteName } from "@/lib/site-url";

export type SendCodeState = { ok?: boolean; error?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendRegisterCodeAction(
  _prev: SendCodeState,
  fd: FormData,
): Promise<SendCodeState> {
  const ip = clientIp(await headers());
  if (!rateLimit(`regcode-ip:${ip}`, 10, 60 * 60_000))
    return { error: "发送过于频繁，请 1 小时后再试" };

  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "请先填写正确的邮箱地址" };
  if (!rateLimit(`regcode-mail:${email}`, 1, 60_000))
    return { error: "验证码已发送，请 1 分钟后再试" };

  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (u) return { error: "该邮箱已被注册" };

  if (!(await smtpConfigured())) return { error: "站点未配置邮件服务，请联系管理员" };

  const code = issueRegisterCode(email);
  const mail = await sendMail(
    email,
    `【${siteName()}】注册验证码`,
    `你的注册验证码是：${code}\n\n10 分钟内有效，请勿泄露给他人。若非本人操作请忽略本邮件。`,
    renderMailHtml({
      title: "注册验证码",
      lines: ["你正在注册 " + siteName() + " 账号，验证码如下："],
      highlight: code,
      note: "验证码 10 分钟内有效，请勿泄露给他人；若非本人操作请忽略本邮件。",
    }),
  );
  if (!mail.delivered) return { error: "邮件发送失败，请稍后再试" };
  return { ok: true };
}
