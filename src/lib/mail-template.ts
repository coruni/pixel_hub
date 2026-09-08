// 邮件 HTML 模板：品牌头 + 正文段落 + 可选主操作按钮 + 页脚。
// 风格对齐站点像素语言（globals.css token）：全直角（站点 border-radius:0）、brand 色系硬边框、
// 像素硬阴影（无模糊 offset 阴影）、方块点缀。外层底色 brand-100 #faece3，卡片白底 + brand-200 边。
// 邮件客户端 CSS 支持极差：<style> 常被剥离、flex/grid 不支持——全部内联样式、块级布局、
// 无外部资源/图片；box-shadow 属渐进增强（Outlook 等不支持时仍是直角品牌卡片，不破坏布局）。
// sendMail 的 text 参数仍保留为纯文本兜底。
import { siteName, siteUrl } from "@/lib/site-url";

export type MailContent = {
  /** 正文主标题 */
  title: string;
  /** 正文段落（每项一段；段落内 \n 会被保留） */
  lines: string[];
  /** 醒目大字段（如验证码，可选） */
  highlight?: string;
  /** 主操作按钮（可选） */
  linkUrl?: string;
  linkText?: string;
  /** 按钮下的小字备注（有效期等，可选） */
  note?: string;
};

export function renderMailHtml(c: MailContent): string {
  const name = siteName();
  const host = new URL(siteUrl()).host;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const paragraphs = c.lines
    .map(
      (l) =>
        `<p style="margin:0 0 14px;font-size:14px;line-height:1.8;color:#44403c;white-space:pre-line;">${esc(l)}</p>`,
    )
    .join("");
  // 像素方块点缀（站名前的小色块，与站点导航徽标色条同语言）
  const square =
    `<span style="display:inline-block;width:10px;height:10px;background:#d97757;margin-right:8px;vertical-align:baseline;"></span>`;
  const highlight = c.highlight
    ? `<div style="margin:20px 0;padding:16px 18px;background:#fdf5f0;border:2px solid #d97757;text-align:center;box-shadow:4px 4px 0 #f4d9c8;">
        <span style="font-size:26px;font-weight:700;letter-spacing:8px;color:#c25e3c;">${esc(c.highlight)}</span>
      </div>`
    : "";
  const button =
    c.linkUrl && c.linkText
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;"><tr><td style="background:#d97757;border:2px solid #a84e31;box-shadow:3px 3px 0 #8a4129;">
          <a href="${esc(c.linkUrl)}" style="display:inline-block;padding:11px 30px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(c.linkText)}</a>
        </td></tr></table>`
      : "";
  const note = c.note
    ? `<p style="margin:12px 0 0;font-size:12px;line-height:1.7;color:#a8a29e;">${esc(c.note)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<body style="margin:0;padding:0;background:#faece3;">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px;font-family:-apple-system,'PingFang SC','Microsoft YaHei','Segoe UI',sans-serif;">
    <div style="background:#ffffff;border:2px solid #f4d9c8;box-shadow:4px 4px 0 #f4d9c8;">
      <div style="padding:20px 28px;border-bottom:3px solid #d97757;">
        <span style="font-size:17px;font-weight:700;color:#171717;">${square}${esc(name)}</span>
        <span style="float:right;font-size:12px;color:#a8a29e;padding-top:4px;">${esc(host)}</span>
      </div>
      <div style="padding:26px 28px 8px;">
        <h1 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#171717;">${esc(c.title)}</h1>
        ${paragraphs}
        ${highlight}
        ${button}
        ${note}
      </div>
      <div style="padding:16px 28px 22px;border-top:2px solid #faece3;">
        <p style="margin:0;font-size:12px;line-height:1.7;color:#a8a29e;">
          本邮件由 ${esc(name)} 系统发送，请勿直接回复；若非本人操作请忽略。
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}
