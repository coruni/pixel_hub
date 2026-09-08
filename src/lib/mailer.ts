import nodemailer from "nodemailer";
import { siteName, siteUrl } from "@/lib/site-url";
import { getRuntimeConfig } from "@/lib/runtime-config";

// 邮件发送：SMTP 配置（后台「站点配置」或旧 .env）齐备才真正发信；否则静默降级
//（开发环境返回链接由页面展示，方便联调）。
// SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM（缺省 noreply@站点域名）

export type MailResult = { delivered: boolean; previewLink?: string };

/** 生效的 SMTP 配置（后台配置 > env 回退） */
async function smtpCfg() {
  const c = await getRuntimeConfig();
  const host = c.smtpHost || process.env.SMTP_HOST || "";
  const user = c.smtpUser || process.env.SMTP_USER || "";
  const pass = c.smtpPass || process.env.SMTP_PASS || "";
  const port = Number(c.smtpPort || process.env.SMTP_PORT || 587);
  const from = c.mailFrom || process.env.MAIL_FROM || `noreply@${new URL(siteUrl()).host}`;
  return { host, port, user, pass, from, configured: !!(host && user && pass) };
}

/** SMTP 是否可用（后台「站点配置」或旧 env 配置齐备）；验证码等功能的启用前置条件 */
export async function smtpConfigured(): Promise<boolean> {
  return (await smtpCfg()).configured;
}

export async function mailFrom(): Promise<string> {
  return (await smtpCfg()).from;
}

export async function sendMail(
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<MailResult> {
  const cfg = await smtpCfg();
  if (!cfg.configured) {
    // 未配置 SMTP：开发环境把正文（含重置链接）返回给调用方展示；生产环境只记日志
    console.warn(`[mailer] SMTP 未配置，邮件未发送 → ${to}：${subject}`);
    return {
      delivered: false,
      previewLink: process.env.NODE_ENV === "development" ? text : undefined,
    };
  }
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transport.sendMail({ from: `${siteName()} <${cfg.from}>`, to, subject, text, html });
    return { delivered: true };
  } catch (e) {
    console.error("[mailer] 发送失败", e);
    return { delivered: false };
  }
}
