import { prisma } from "@/lib/db/prisma";
import { sendMail } from "@/lib/mailer";
import { rateLimit } from "@/lib/rate-limit";
import { siteName, siteUrl } from "@/lib/site-url";

// 邮件通知通道：MAIL_NOTIFY=1 且 SMTP 配置齐备时启用；
// 每用户每小时最多 5 封（防轰炸），失败静默（邮件是尽力而为的副通道，不阻断主流程）。
// 只在「值得打扰」的场景调用：评论回复、审核结果；点赞/关注仅站内通知。

export function emailNotifyEnabled(): boolean {
  return process.env.MAIL_NOTIFY === "1" && !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function notifyByEmail(
  userId: string,
  subject: string,
  body: string,
  linkPath?: string,
): Promise<void> {
  try {
    if (!emailNotifyEnabled()) return;
    if (!rateLimit(`mail:${userId}`, 5, 60 * 60_000)) return;
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!u?.email) return;
    const link = linkPath ? `${siteUrl()}${linkPath}` : undefined;
    await sendMail(
      u.email,
      `【${siteName()}】${subject}`,
      `${body}${link ? `\n\n${link}` : ""}\n\n—— 来自 ${siteName()}（可在设置中关闭邮件提醒）`,
    );
  } catch {
    // 邮件失败不影响站内通知
  }
}
