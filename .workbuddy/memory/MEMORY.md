# Pixel Hub —— 长期项目约定（常驻红线）

> **细则一律查同目录 `REFERENCE.md`**（分节：本机验证环境 / 验证纪律 / CSS 布局细则 / UI 文案 / 破坏性操作与评论树 / slug 与 URL 编码 / 邮件与外链 origin / 上传体积与压缩 / 附件与音视频 / 云盘 Graph / ImageViewer / Markdown 与 Crepe / 账务 / 页面标题与收录 / 打包器追踪 / 水印几何 / 详情页落位 / 个人主页背景）。踩坑经过放 `.workbuddy/memory/YYYY-MM-DD.md`。**本文件只放「改错了会再踩一次」的一句句规则，长解释别往这里堆。**

## 验证（开工先读 `REFERENCE.md` 的「本机验证环境」+「验证纪律」两节）
- **禁止浏览器与 CDP**（含 headless、「只量一下」）。可用：tsc/eslint 直调、`prisma/_*.ts` 探针（tsx）、SSR 契约、铸管理员 cookie 纯 HTTP 抓页面。
- `npm`/`npm run` 在本机 shell 不通（退 127），且缺 `ls/grep/head/tail/dirname`、`rm` 是坏 shim ⇒ 用 Read / Grep / node 一行脚本 / `node node_modules/<pkg>/…`。
- **`next build` 预渲染必失败**（`/admin/runtime`、`/_global-error`、`/banned` 报 `Expected workStore to be initialized`）—— 既有问题，编译与 TS 检查是过的；构建不触库，别拿「build 过」当「迁移可跳过」的证据。
- **`next dev` 有目录级互斥锁**：第二实例打印 `⨯ Another next dev server is already running` 并退出 ⇒「端口 ECONNRESET/超时」**不等于**没有实例，先读 `.next/dev/logs/next-development.log`。改 Prisma schema 后必须重启（旧 client 留在内存：**API 200 + 页面 500**）。
- `DATABASE_URL` = **线上 Supabase**（会话池 `connection_limit=5`）：脚本默认只读、退避重试、抓完 `await prisma.$disconnect()`。DB 抖动时鉴权页是静默重定向：SSR = **200 + `<meta id="__next-page-redirect">`**（不是 307/500），判据 = 同 cookie 打 `/api/auth/session` 能否拿到 `role`。
- **新回归断言必须反证一次**（旧实现下如期变红），否则全绿是假信号；探针用完立即删；**本环境会自动提交工作区改动** ⇒ 交付前查 `git ls-files "prisma/_*"` + `git status --short`，绝不用 `git add -A`。
- **含反引号的长文本别塞进 `node -e "…"`**：双引号里的反引号会被 command substitution 真正执行（造过垃圾文件、也把 schema 行改坏过）⇒ 追加记忆/日志/文档一律用 Write / Edit。
- 存量 3 条 `no-unused-vars` warning（`admin/media/page.tsx:enumParam`、`auth/PublishForm.tsx:draftCount`、`sidebar/SiteSidebar.tsx:authed`）：别改也别新增。

## 编辑纪律
- **同一文件的多处改动别放进同一批并行编辑调用**：会互相覆盖且**失败的静默丢失**（工具仍回 "Successfully edited"；丢过 `home.ts` 的 `metricById`、`home-config.ts` 的联合类型、`site-config.ts` 的 meta 描述）。规则：**一个文件一次只改一处**，改完 grep + tsc 核对；并行只用于**不同文件**。症状：tsc 报「Cannot find name X」而 X 明明加过 → 先怀疑 import 行被覆盖。
- `.workbuddy/` 受 git 跟踪（**是项目数据，不是缓存**，别删），误删 `git checkout -- .workbuddy/`；删未提交文件前先 `copyFileSync` 到 `%TEMP%`。

## CSS / 布局（细则见 `REFERENCE.md`）
- 单列 grid 必须显式 `grid-cols-1`；**改 class 后必须核 Tailwind 真产出了该类**（编 `globals.css` 查选择器）；覆盖第三方主题（Crepe）一律 4 层选择器压它的 3 层。
- **区块自带的 `mt-*` = 「与上一个块拉开距离」**：该块**可能成为容器首块**时（前驱被条件渲染跳过，如 `{cond && <X/>}`）必须写成 `mt-6 first:mt-0`，否则该分支首块平白多一段上边距，而别的分支看着正常。实例 = `av-player` 播放卡。
- `SidebarLayout` 外层容器 = `mx-auto max-w-7xl lg:pr-6`（只加右侧，别改成 `px-6`）。
- `.md-body table` 是 `display:block` + `overflow-x:auto`：**别改回纯 table** —— 那正是详情页整页横向滚动条的来源。

## UI 文案 / 破坏性操作（细则见 `REFERENCE.md`）
- **前台与后台是两套标准**：「配置含义」只属后台；前台只留**约束 / 后果 / 状态**三类。前台禁止配置数值复述、实现说明、「可在后台配置」、内部术语（`偿付闸门` → 「顺延到收入到账后再处理」）、设计理由、对外提「密钥」。中文 UI 文案别写反引号；图标按钮的 `title` 是无障碍名称，必留。
- **全站禁止原生 `confirm`/`alert`/`prompt`** ⇒ 统一 `feedback.tsx` 的 `confirmDialog()`/`toast()`。删除类 = 确认 → 调 action（**失败原因要能直接 toast**：返回 `error?: string`）→ 立刻进「进行中」态 → `finally` 里 `router.refresh()`。
- **评论楼层树的根判定必须与 `rootIdOf` 同一口径**（根 = 无父 **或** 父已被删），否则「父被删的回复」既不属根也不在任何 replies 里 ⇒ 整条被静默吞掉；`commentCount` 对每条评论（含回复）都 `+1`，改成连回复一起删要同步补扣。

## 详情页（用户明确要过，别改回去）
- 四模板共用 `src/components/resource/detail/parts.tsx`；**描述正文唯一实现 = `DescriptionBlock`**（裸 `md-body md-body--lg`，无卡片/底色/边框）。
- **音视频播放器 = 自建控件**（`detail/av-controls.tsx`）：全站禁止再用原生 `controls`；下载入口由 `av-player.tsx` 以 `downloadSlot` 注入（用 `MetaDownloadButton` 的 `iconOnly` + `className`，其**默认翠绿实底路径逐字保持**）；控件类名统一在 `cls.ts` 的 `AV_CTRL_*`。
- **四模板内容顶部间距统一 `pt-8`**（post 曾是 `pt-6`，而 MUSIC/VIDEO 实走 post）；**播放卡根 `<section>` = `mt-6 first:mt-0`**（video 不渲染 `Gallery` ⇒ 它是容器首个子元素）。两处都别再改回去。
- **打赏入口只在个人主页**（2026-09-25 用户定）：详情页的作者名片与动作条都不再有打赏按钮；作品维度的 `TipButton` 与其服务端 action 保留，但已无 UI 入口。
- 四处落位、`CollapsibleAside` 锁宽等见 `REFERENCE.md` —— **落位被纠正过两次，动之前先查**；**回退不要按目录**（`git checkout HEAD -- <dir>` 会带走该目录所有未提交改动，先 `git diff --stat`）。

## 个人主页头部（2026-09-25 用户定，别改回去）
- 头部只剩 **头像 + 资料两列**；操作项（关注 / 打赏 / 编辑）全收进**昵称行右端**（`ml-auto`），其中打赏与编辑是**图标按钮**（`iconBtn`，h-9 方形，`title` + `aria-label` 承担无障碍名），不再是「编辑资料」文字按钮。hero / 无 hero 两套头部共用同一个 `nameActions` 节点（只补一套 → 另一套会莫名缺按钮）。
- 个人主页**不再显示「免审发布」徽章**；`profile.trusted` 仍驱动直发/上传权限，别顺手删字段。

## 邮件 / 外链 origin（细则见 `REFERENCE.md`）
- 唯一入口 = `src/lib/request-origin.ts` 的 `requestSiteUrl()`（邮件链接、`api/pay/create`）。**公网 origin 一律不带端口**：转发头里的端口常是上游内部端口（`X-Forwarded-Host: site.com:3000`、`X-Forwarded-Port: 3000`），收件人打开必然连不上 —— 这就是「邮件链接带 :3000」的根因。**只有回环主机**（localhost / 127.* / [::1]）与**零转发头的直连**保留端口。别退回「host 剥端口 + x-forwarded-port 补回」的旧判据。

## 云盘 / IP 防刷
- **507 = 配额爆了，不是连不通**（`quotaLimitReached`）：同租户站点盘还能写 ⇒ 问题在**每用户配额**（OneDrive 许可被重置回默认即此症状，数据不丢、站点转只读）；`/admin/drives` 的 active 盘指向这种盘 = 新附件全挂，先切盘再排查。
- IP 取法与哈希**唯一实现 = `src/lib/ip.ts`**（`ipFromHeaders()` / `hashIp()` / `subjectKeyFor()`）；**别再往 `track/route.ts` 加内联第二份**（曾漏 `x-real-ip` 回退 → 无反代部署下全站共用一个限流桶）。

## 首页 / creators / metadata
- 「加载更多」= `paged` + `loadMode: "button" | "infinite"`：**别把 `paged` 合并成单字段**（存量 JSON 只有 `paged`）；`useLoadMore` 的 page/done 用 ref、并发用 ref 闩；哨兵 effect 依赖要带 `more.length`。
- `getTopCreators(limit, sort="followers", period="all")`：**默认值就是兼容红线**；返回的 `metric` = 驱动本次排名的那个数，展示必须走同一个 `creatorMetaText(...)`；配置四处同步（两个 `creatorsCfg`、`HomeSectionConfig` 联合、`DEFAULT_*`）+ 后台**两个**编辑器。

## TS 联合类型陷阱
- 往按 shape 区分的联合（`HomeSectionConfig` / `SidebarWidgetConfig`）加字段时，字段名与别的成员重名会让对象字面量挑错成员并报看不懂的错。**看到 `never` 的赋值错误，先怀疑 `Record<string, never>`**；对策 = schema / 联合类型 / 默认值 / 全部构造点一次补齐。

## 账务 / 水印 / 个人主页背景（只列红线，细则见 `REFERENCE.md`）
- 阈值与分值**唯一落点 = `points-config.ts`**（业务模块不许再写业务数值字面量）；唯一写入口 = `points.ts: awardPoints()`，**`refId` 必须把触发者编进去**；冻结名单唯一事实来源 = `cfg.risk.frozenUserIds`。
- **PUBLISH 分有两个发放点，缺一不可**（`moderation.ts:approveResourceAction` + `actions/resource.ts` 的直发分支）⇒ 新增任何「把资源变成 PUBLISHED」的路径都要同步补；`restoreResource` 与举报复核刻意不发。
- 结算 = **月粒度 + 人工触发**；分只看**当期新增**、跨期只结转钱、**确认必须按月份先后**、已确认期**沿用快照绝不重算**；后台配置保存是**整份替换（WYSIWYG）**；`IncentiveManager` 数值叶子只能走 `num()`（否则保存后值弹回原样）。
- 水印只有两条链路（`/api/upload` → `processImage()`、评论附图 `saveCommentImage()`）；开关是**用户级偏好**且取当前登录者；样式必须**深填充 + 浅描边**、放不下缩字号不设下限；**fontkit 没有 default 导出**（`import * as` + `serverExternalPackages`）。
- 个人主页背景 = **一张图、一个槽、仅桌面端**（移动端那版是用户明确砍掉的，别加回来）；判定唯一入口 = `profileBgUnlocked()`，**action 里必须重算**；**资源详情页铺的是「作者的」背景**（作者有图 + `profileBgOnResource` 开 + 作者当前仍达等级），那两个字段是**裸 storage key**，页面侧要 `publicUrl()`。

## slug / URL（新写入恒为纯 ASCII，存量中文 slug 仍要可达）—— 细则见 `REFERENCE.md`
- 落库 slug **唯一生成入口 = `slug.ts` 的 `asciiSlug()` / `autoSlugBase()`**，别直接拿 `slugify()` 写库；跳转到动态段一律 `encodeURIComponent`。
- **Next 16 的页面 `params` 不解码** ⇒ 用 slug 查库的页面必须过 `decodeSlug()`（只解一次），否则存量中文 slug 整页 404；`sitemap.ts` 拼 `<loc>` 要 `encodeURIComponent`。
