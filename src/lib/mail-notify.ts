import { prisma } from "@/lib/db/prisma";
import { sendMail } from "@/lib/mailer";
import { renderMailHtml } from "@/lib/mail-template";
import { rateLimit } from "@/lib/rate-limit";
import { siteName } from "@/lib/site-url";
import { requestSiteUrl } from "@/lib/request-origin";
import { getRuntimeConfig } from "@/lib/runtime-config";

// 邮件通知通道：后台「站点配置」开启邮件通知（或旧 env MAIL_NOTIFY=1）且 SMTP 配置齐备时启用；
// 每用户每小时最多 5 封（防轰炸），失败静默（邮件是尽力而为的副通道，不阻断主流程）。
// 只在「值得打扰」的场景调用：评论回复、审核结果；点赞/关注仅站内通知。

export async function emailNotifyEnabled(): Promise<boolean> {
  const c = await getRuntimeConfig();
  const notifyOn = c.mailNotify || process.env.MAIL_NOTIFY === "1";
  if (!notifyOn) return false;
  const host = c.smtpHost || process.env.SMTP_HOST;
  const user = c.smtpUser || process.env.SMTP_USER;
  const pass = c.smtpPass || process.env.SMTP_PASS;
  return !!(host && user && pass);
}

export type EmailNotifyKind = "comment" | "moderation";

// kind 决定按用户哪个开关过滤（设置-通知里对应两类邮件提醒，均默认开启）
export async function notifyByEmail(
  userId: string,
  subject: string,
  body: string,
  linkPath?: string,
  kind: EmailNotifyKind = "comment",
): Promise<void> {
  try {
    if (!(await emailNotifyEnabled())) return;
    if (!rateLimit(`mail:${userId}`, 5, 60 * 60_000)) return;
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailNotifyComment: true, emailNotifyModeration: true },
    });
    if (!u?.email) return;
    const optedIn =
      kind === "moderation" ? u.emailNotifyModeration !== false : u.emailNotifyComment !== false;
    if (!optedIn) return; // 用户可在设置中按类型关闭邮件提醒
    // 通知链接用"当前请求"的公网域名（CDN/反代兼容），勿用 .env 静态域名
    const link = linkPath ? `${await requestSiteUrl()}${linkPath}` : undefined;
    const text = `${body}${link ? `\n\n${link}` : ""}\n\n—— 来自 ${siteName()}（可在设置中关闭邮件提醒）`;
    await sendMail(
      u.email,
      `【${siteName()}】${subject}`,
      text,
      renderMailHtml({
        title: subject,
        lines: [body],
        linkUrl: link,
        linkText: "查看详情",
        note: `可在站内设置中关闭邮件提醒。—— 来自 ${siteName()}`,
      }),
    );
  } catch {
    // 邮件失败不影响站内通知
  }
}
