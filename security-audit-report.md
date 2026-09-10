# Pixel Hub 安全审计报告

> 审计范围：pixel_hub 仓库源代码（Next.js 16 / React 19 / Prisma / Auth.js v5 / PostgreSQL）
> 审计视角：OWASP Top 10 (2021) + 通用安全配置
> 方法：静态代码审查 + 线上响应头实测（Bingbot UA，poixel.top）
> 审计日期：2026-09-10
> 结论摘要：**未发现可直接导致数据泄露 / RCE 的 Critical 漏洞**；发现 **2 项 High（纵深防御缺失）** 与 **3 项 Medium**，其余为 Low。认证授权与越权防护设计扎实，是项目安全基线最好的部分。

---

## 一、风险总览

| 等级 | 数量 | 项 |
|---|---|---|
| Critical | 0 | — |
| High | 2 | H1 缺失安全响应头；H2 限流内存化在多实例生产下失效 |
| Medium | 3 | M1 广告 HTML 原样注入；M2 注册验证码内存化（同 H2 根因）；M3 边缘门控不校验角色（约定而非强制） |
| Low | 4 | L1 bcrypt 轮数；L2 OAuth token 明文；L3 登录密码长度下限；L4 依赖审计未跑成 |

---

## 二、High 级发现（应当优先修复）

### H1 — 安全响应头全部缺失（A05 安全配置错误 / A07 纵深防御）

**位置**：`next.config.ts`（整文件无 `headers()` 配置）；线上实测 `poixel.top` 响应头无 `Content-Security-Policy` / `X-Frame-Options` / `X-Content-Type-Options` / `Referrer-Policy` / `Strict-Transport-Security`。

**风险**：
- 无 `frame-ancestors 'self'` / `X-Frame-Options` → `/admin` 等页面可被 iframe 钓鱼（点击劫持，A01 越权前置）。
- 无 CSP → 一旦任何 XSS 命中（见 M1 广告位），无兜底拦截。
- 无 `X-Content-Type-Options: nosniff` → 浏览器 MIME 嗅探可能把上传/响应当成可执行类型。
- 无 `Strict-Transport-Security` → 存在 SSL strip 风险。

**修复（next.config.ts 增加 headers；先上"不破坏现有内联脚本"的宽松档，再向 nonce 演进）**：

```ts
// next.config.ts
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // 宽松档：保留 'unsafe-inline' 不破坏 themeInitScript / JSON-LD 内联脚本；
  // frame-ancestors / object-src / base-uri 已能挡点击劫持与注入兜底。
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // ...existing
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
```

**演进建议**：将 `themeInitScript` 和 JSON-LD 改为带 `nonce` 的内联脚本（Next 16 支持 `headers()` 注入 nonce 并由 `next/script` 消费），随后把 `script-src` 收紧为 `'self' 'nonce-xxx'`，彻底移除 `unsafe-inline`。

---

### H2 — 速率限制为内存 Map，Serverless 多实例下失效（A07 限流缺失 / 认证暴力）

**位置**：`src/lib/rate-limit.ts`（全局 `Map` 内存桶）；`src/lib/actions.ts:27`（登录限流）、`register-code.ts:22`、`password-reset.ts:32`、`social.ts`（评论/关注）、`app/api/upload/*` 等。

**风险**：
- 代码注释已自承"单进程部署够用；多实例/生产可换 Redis"。
- 生产部署为 Vercel（schema 注释确认 `生产=Vercel env`），Next.js 函数默认**多实例 / 自动扩缩**，每个实例独立内存 → **登录、注册、密码重置、评论、关注等限流在真实生产环境基本失效**，攻击者可将请求分散到不同实例绕过计数，登录凭据暴力破解的护栏被架空。
- `clientIp()` 取 `x-forwarded-for` 第一段，依赖 CDN/Vercel 正确覆盖客户端真实 IP；若源站可被直连且伪造该头，限流维度失真。

**修复（集中式限流）**：

```ts
// 方案 A：Upstash Redis（Vercel 友好，@upstash/ratelimit + @vercel/kv）
import { Ratelimit } from "@upstash/ratelimit";
import { kv } from "@vercel/kv";
export const loginLimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(10, "5 m"),
});
// 调用：await loginLimit.limit(ip) -> { success }
```
```ts
// 方案 B：edge 限流（proxy.ts 内，对 /login、/api/auth 等前缀统一限流）
```
- 同时要求 CDN 层丢弃外部传入的 `x-forwarded-for`，仅信任边缘节点写入的真实客户端 IP。

---

## 三、Medium 级发现（建议修复）

### M1 — 广告 HTML 原样注入（A03 存储型 XSS，仅管理员可控）

**位置**：`src/components/ads/AdBlock.tsx:35` `dangerouslySetInnerHTML={{ __html: cfg.html }}`；`html` 来自后台 `runtime-config`（写入 action `runtime-config.ts` 有 `adminOnly()` 守卫）。

**风险**：配置仅管理员可写，因此是**管理员自 XSS**——本身不越权，但一旦管理员账号被盗，攻击者可向全站所有广告位注入任意脚本（配合 H1 缺失 CSP，无兜底）。属特权 XSS。

**修复**：
- 短期：上 H1 的 CSP（至少 `script-src` 限制生效）即可大幅兜底。
- 长期：广告 `html` 不再原样注入，改为白名单校验（仅允许已知广告联盟脚本域名 + `sandbox` 隔离 iframe）；或对 `html` 做 DOM 净化（如 `sanitize-html` / `DOMPurify` 服务端版），仅放行 `<script src=受信域>`、`<ins>`、`<a>` 等。

### M2 — 注册验证码内存化，多实例下不可用（功能性 + 安全相关，根因同 H2）

**位置**：`src/lib/register-code.ts`（全局 `Map` 内存 store，`issueRegisterCode` / `verifyRegisterCode`）。
**风险**：签发在一个实例、验证在另一个实例 → 永远 `mismatch`，用户无法走完邮箱验证码注册（可用性问题，且在多实例下等于"验证码失效"）。与 H2 同一根因，应一并迁到 Redis/KV。
**修复**：验证码 store 与限流共用集中式存储（可用 Upstash 等带 TTL 的 KV）。

### M3 — 边缘门控只校验"是否登录"，不校验角色（纵深防御约定）

**位置**：`src/proxy.ts` 用 `authConfig.authorized`（`!!auth?.user`）；角色校验落在各 admin 页面 / action 内部的 `adminOnly()` / `staff()`。
**现状**：grep 确认所有 admin action（admin-content、admin-media、drives、home、docs、moderation、site、taxonomy、seo、uploads、runtime-config）**均已调用守卫，覆盖良好**。
**风险**：当前无漏洞，但角色校验是"约定"而非强制——任何新增 admin 入口漏写 `adminOnly()` 即产生越权暴露面。另外 `proxy.ts` 用的是无 DB 回查的 `authConfig`，封禁用户基于旧 JWT 仍会穿过 proxy 层（最终在应用层 `auth.ts` 的 jwt 回查被拒，功能正确，但多一跳）。
**修复建议**：将 `/admin/*` 的角色校验也下沉到 proxy（或抽出共享 `requireAdmin()` 守卫强制每个入口调用），降低漏写风险。

---

## 四、Low 级发现

| # | 位置 | 说明 | 建议 |
|---|---|---|---|
| L1 | `lib/auth.ts:118`、`actions.ts:118`、`settings.ts:265`、`password-reset.ts:90` | `bcrypt.hash(pw, 10)`，轮数 10 可用但偏保守 | 提升 `saltRounds` 至 12（在登录吞吐允许范围内） |
| L2 | `prisma/schema.prisma:67-83` `Account` | OAuth `access_token`/`refresh_token` 明文存储（Auth.js adapter 标准行为） | 确保数据库层加密（磁盘加密 / 传输加密）；不要将 DB 凭证泄露到日志 |
| L3 | `lib/auth.ts:14` `credentialSchema` | `password: z.string().min(1)`，无长度上限 | 加 `max(200)` 防超大输入带来的 bcrypt 计算开销（bcrypt 本身截断 72 字节，风险极低） |
| L4 | 依赖审计 | `npm audit` 在 npmmirror 镜像返回 `NOT_IMPLEMENTED`，未跑成 | 用官方 registry 或 Snyk 复测依赖已知漏洞 |

---

## 五、已确认的安全强项（保留，勿回退）

- **边缘登录门控**：`src/proxy.ts`（Next.js 16 以 `proxy` 取代 `middleware`，使用 edge-safe `authConfig`，matcher 覆盖 `/upload /settings /notifications /admin`）。✅
- **admin 守卫全面覆盖**：所有 admin server action 均调用 `adminOnly()` / `staff()`（grep 验证）。✅
- **越权 / IDOR 防护**：`resource.ts:300` 编辑校验 `authorId === user.id || ADMIN`；`resource.ts:346` 仅作者可删；`where: { id, uploaderId: user.id, … }` 媒体认领防抢他人素材。✅
- **注册验证码**：`crypto.randomInt` CSPRNG 生成、6 位、5 次尝试上限、10 分钟 TTL、不落库不进日志。✅
- **上传安全**：魔数嗅探（`sniff()` 校验 png/jpg/webp/gif/avif，不信任客户端 mime）+ 大小上限 + 文件名 `replace(/[\\/]/g,"_")` 防路径穿越 + `sameOrigin()` 防 CSRF。✅
- **Markdown 渲染**：react-markdown 默认不渲染原始 HTML，`urlTransform` 默认剥离 `javascript:` / `data:` 协议。✅
- **JSON-LD 注入防护**：`jsonLd()`（`seo-config.ts:121`）`JSON.stringify(data).replace(/</g, "\u003c")`，防 `</script>` 破坏。✅
- **密码重置**：`PasswordResetToken.tokenHash` 哈希落库 + 30 分钟过期 + `usedAt` 用过即焚。✅
- **隐私**：`Visit.ipHash` 加盐哈希，不存明文 IP。✅
- **会话即时失效**：JWT 每次请求 DB 回查（`auth.ts` jwt 回调），封禁 / 改密 / 取消免审立即生效；`pw` 签名为 passwordHash 尾部，改密后旧 token 全部失效。✅
- **OAuth 防劫持**：`allowDangerousEmailAccountLinking: false`，GitHub 邮箱不会自动并入站内账号。✅
- **NSFW 设计性不可见**：未登录/爬虫访问 NSFW 详情 → 404 + noindex，列表与 sitemap 均不含 NSFW。✅

---

## 六、修复优先级与下一步

1. **P0（本周）**：H1 安全响应头（CSP 宽松档 + X-Frame-Options + nosniff + HSTS）——纯配置，零业务风险，立刻堵住点击劫持与 XSS 兜底缺口。
2. **P0（本周）**：H2 + M2 限流 / 验证码迁集中式存储（Upstash/Redis/KV）——恢复登录暴力防护、修复多实例注册验证码失效。
3. **P1（下周）**：M1 广告 HTML 净化 / 沙箱化；M3 角色守卫强制化（共享 `requireAdmin()`）。
4. **P2**：L1 bcrypt 升 12；L4 跑官方依赖审计（Snyk）。

> 涉及 `next.config.ts`、`.env*`、`prisma/schema.prisma`、Auth 相关文件的改动，建议在受控环境人工复核后再发布；本报告中的"错误示例 → 正确示例"代码片段仅供实现参考，落地时以仓库现有样式与 `AGENTS.md` 约束为准。
