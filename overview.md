# 注册邮箱验证码 + 邮件 HTML 模板 — 交付说明

## 1. 注册邮箱验证码

- **流程**：注册页填写邮箱 → 点「发送验证码」（6 位数字，10 分钟有效）→ 输码提交注册
- **发送防线**：IP 每小时 10 次 + 单邮箱每分钟 1 次（防邮件轰炸）；已注册邮箱直接拒绝
- **校验**：`registerAction` 注册前验证码匹配（最多 5 次尝试，超限作废；`crypto.randomInt` 生成，验证成功即销毁）
- **存储**：内存 TTL Map（与 rate-limit 同款单实例假设，零迁移成本，进程重启丢码重发即可）
- **启用条件**：后台「站点配置 → SMTP 邮件 → 注册需邮箱验证码」开关（默认关）+ SMTP 可用；未配置邮件服务时验证码栏不渲染、注册照常——开箱即用，配置后显式开启
- **UI**：验证码栏带发送按钮 + 60 秒倒计时（与服务端限流对齐），成功/失败/过期/超限各有明确提示

## 2. 邮件 HTML 模板

- 新建 `renderMailHtml`：品牌头（站名 + 域名 + 品牌橙色条）、正文段落、醒目大字段（验证码）、主操作按钮、脚注；全部内联样式 + 无外部资源（邮件客户端兼容）
- `sendMail` 的纯文本参数保留为兜底
- **换用模板的邮件**：密码重置（含重置按钮 + 30 分钟有效期备注）、评论回复/审核结果通知（含「查看详情」按钮）、注册验证码（大字验证码）

## 验证

- `npx tsc --noEmit` 全量零错误；`npx eslint` 全部改动文件零警告

## 改动文件

新建：`src/lib/mail-template.ts`、`src/lib/register-code.ts`、`src/lib/actions/register-code.ts`
修改：`lib/actions.ts`（registerAction）、`actions/password-reset.ts`、`mail-notify.ts`、`mailer.ts`（导出 smtpConfigured）、`runtime-config.ts`（emailCodeRequired）、`(auth)/register/page.tsx`、`register-form.tsx`、`RuntimeConfigManager.tsx`
