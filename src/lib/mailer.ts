import nodemailer from "nodemailer";
import { siteName, siteUrl } from "@/lib/site-url";

// 邮件发送：SMTP 环境变量齐备才真正发信；否则静默降级（开发环境返回链接由页面展示，方便联调）。
// SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM（缺省 noreply@站点域名）

export type MailResult = { delivered: boolean; previewLink?: string };

function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function mailFrom(): string {
  return process.env.MAIL_FROM ?? `noreply@${new URL(siteUrl()).host}`;
}

export async function sendMail(
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<MailResult> {
  if (!smtpConfigured()) {
    // 未配置 SMTP：开发环境把正文（含重置链接）返回给调用方展示；生产环境只记日志
    console.warn(`[mailer] SMTP 未配置，邮件未发送 → ${to}：${subject}`);
    return {
      delivered: false,
      previewLink: process.env.NODE_ENV === "development" ? text : undefined,
    };
  }
  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({ from: `${siteName()} <${mailFrom()}>`, to, subject, text, html });
    return { delivered: true };
  } catch (e) {
    console.error("[mailer] 发送失败", e);
    return { delivered: false };
  }
}
