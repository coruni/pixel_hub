# Pixel Hub —— 长期项目约定（常驻红线）

> 只留「改错了会再踩一次」的规则。**细则按主题查同目录 `REFERENCE.md`**（上传体积/图片压缩、附件与音视频上传、云盘 Graph/OneDrive、ImageViewer、Markdown 编辑器与 Crepe 样式、打包器文件追踪、本机验证环境）；踩坑经过放 `.workbuddy/memory/YYYY-MM-DD.md`。

## 验证（流程全在 `pixel-hub-verify` skill，开工先加载）
- **禁止浏览器与 CDP**（用户明确要求，含 headless、「只量一下不算 e2e」）。可用：tsc/eslint 直调、`prisma/_*.ts(x)` 探针、SSR 契约、铸管理员 cookie 抓页面（纯 HTTP）。
- `npm` 在此 bash 里不通（退 127）→ 直调 `node_modules/typescript/bin/tsc --noEmit`、`node_modules/eslint/bin/eslint.js src`。存量 3 条 no-unused-vars warning（`admin/media/page.tsx:enumParam`、`auth/PublishForm.tsx:draftCount`、`sidebar/SiteSidebar.tsx:authed`）：别改也别新增。
- **`next build` 预渲染阶段必失败**（`/admin/runtime`、`/_global-error`、`/banned` 报 `Expected workStore to be initialized`）—— 既有问题，编译与 TS 检查是过的。构建不触库（路由全 `ƒ`），别拿「build 过」当「迁移可跳过」的证据。
- **`next dev` 有目录级互斥锁**：第二实例打印 `⨯ Another next dev server is already running` 并退出 → 「端口 ECONNRESET/超时」**不等于**没有实例，先读 `.next/dev/logs/next-development.log`。改 Prisma schema 后必须重启 dev server（旧 client 在内存里：**API 200 + 页面 500** ≈ 进程内 client 陈旧）。
- `DATABASE_URL` 指向**线上 Supabase**（会话池 `connection_limit=5`）：脚本默认只读、退避重试、抓完 `await prisma.$disconnect()` 让路。DB 抖动时鉴权页是「静默重定向」：SSR = **200 + `<meta id="__next-page-redirect">`**（不是 307/500），判据 = 同 cookie 打 `/api/auth/session` 能否拿到 `role`。
- 断言类：canonical 输出**绝对 URL** 且 `&` 转义成 `&amp;` → 先 `new URL()` 归一；查 BOM 不能用 `fetch().text()`（剥 U+FEFF）→ `Buffer.from(await r.arrayBuffer())`。**新回归断言必须反证一次**（旧实现下如期变红），否则全绿是假信号。
- 探针 `_` 前缀放 `prisma/`、**用完立即删**；HTTP 层脚本别进仓库，跑完连 admin cookie 一起删。**探针曾被误提交**（`c01bd55`）→ 提交前 `git status --short` 逐行确认，绝不用 `git add -A`。
- **含反引号的长文本别塞进 `node -e "…"`**：反引号会被 command substitution **真正执行**（曾凭空造出 `1`、`=20` 垃圾文件）→ 一律用 Write 落临时文件再让 node 读。

## 编辑纪律（真实踩到过）
- **同一文件的多处改动别放进同一批并行编辑调用**：会互相覆盖且**失败的静默丢失**（工具仍回 "Successfully edited"）。曾丢过 `home.ts` 的 `metricById`、`home-config.ts` 的联合类型、`site-config.ts` 的 meta 描述。规则：**一个文件一次只改一处**，改完 grep + tsc 核对；并行只用于**不同文件**。症状：tsc 报「Cannot find name X」而 X 明明加过 → 先怀疑 import 行被覆盖。
- `.workbuddy/` 受 git 跟踪（**是项目数据，不是缓存**，别删），误删用 `git checkout -- .workbuddy/`；删未提交文件前先 `copyFileSync` 到 `%TEMP%`。

## CSS / 布局
- 单列 grid 必须显式 `grid-cols-1`（= `minmax(0,1fr)`）。裸 `grid gap-1` 的隐式 auto 轨道按 min-content 起算，行内 `truncate` 会撑爆卡片。
- `@import "tailwindcss"` 之后的规则**无层**，优先于任何 `@layer`：与 `* { scrollbar-width:thin }` 冲突时 Tailwind 任意值（中括号）写法被静默压掉 → 用无层普通 class（`.scrollbar-none`）。注释里别原样写中括号类名。
- `overflow-x-auto` 会把 overflow-y 变 auto 并裁自身溢出：横向滚动 + 下划线 tab 的 `-mb-px` 挂在**滚动容器**上。
- **改 class 后必须核 Tailwind 真产出了该类**（postcss 编 `globals.css` 再查选择器，见 skill），否则样式静默丢失。覆盖第三方主题（Crepe）一律 4 层选择器压它的 3 层。

## UI 文案（tip）
- **前台与后台是两套标准**：「配置含义」只属于后台（admin `hint` / `sectionHint` / 页首说明框）。前台只留三类 —— **约束**（门槛、金额范围）、**后果**（线下打款、冻结、收入为 0 则池子为 0）、**状态**（已确认 / 已打款）。
- 前台**禁止**：配置数值复述（「安全水位 10% 可用」）、实现说明（「以提交时的比例为准」）、「可在后台配置」、内部术语（`偿付闸门` → 「顺延到收入到账后再处理」）、设计理由、对外提「密钥」。
- 中文 UI 文案**不要用反引号**（会原样渲染，曾被写进 `/creators`）。图标按钮的 `title` 是**无障碍名称**，必留。
- 同一句话不要在一个页面里出现两次（页首说明 + 区块 info 块是常见来源）；跨页重复可接受。无限滚动哨兵（`feed/FeedInfinite.tsx`）删文案后必须保留容器高度，否则 IntersectionObserver 目标塌陷。

## 破坏性操作 / 评论区楼层树
- **全站禁止原生 `confirm`/`alert`/`prompt`**：统一用 `src/components/ui/feedback.tsx` 的 `confirmDialog()` / `toast()`（全局惰性 host，零 Provider 侵入）。删除类 = 先 `confirmDialog({danger:true})` → 调 action → 结果出 `toast`。**action 的失败原因要能直接 toast**（返回 `error?: string`，别只回 `ok:false`）。确认后立刻进「进行中」态（`disabled` + 文案换「删除中…」）再发请求；`finally` 里无论成败都 `router.refresh()`。
- **评论楼层树的根判定必须与 `rootIdOf` 同一口径**：根 = 无父 **或** 父已被删。`filter(c => !c.parentId)` 会让「父被删的回复」**既不是根、也不在任何根的 replies 里，整条被静默吞掉**。改成 `rootIds = Set(rootIdOf(c) === c.id)`，replies 循环用 `if (rootIds.has(c.id)) continue` 排除自身。
- `Resource.commentCount` 对**每条评论（含回复）**都 `+1`，删一条只 `-1`；改成「连回复一起删」必须同步补扣。

## 详情页（用户明确要过，别改回去）
- 四模板共用 `src/components/resource/detail/parts.tsx`；`detailTemplate.byType` 后台可配（信息面板标题不能写死）。**MUSIC / VIDEO 实际走 `post` 模板**（内置 byType 只给 GAME=banner、ARTICLE=article）—— banner 的音频紧凑首屏要后台配成 banner 才生效；post 下吃掉首屏的是 `Gallery` 的 `h-[50vh]` 主图，不是 banner 的 22rem。
- **描述正文 = `parts.tsx` 的 `DescriptionBlock`，唯一实现**：裸 `<section className="md-body md-body--lg">`，无卡片/底色/边框/「描述」小标题，四模板共用（article 也用同一个）。改描述排版只改这一处。
- 操作条 = **图标 + 文字**（Heart/Star/Flag/Pencil，`size={15}`，`aria-hidden`）；无图标版已被否。`ACTION_TEXT`（`src/lib/ui/cls.ts`）：无边框无底色、`gap-1.5 py-1.5 text-sm`；`FollowButton` 是全站唯一保留描边/实底的动作；行容器 `justify-end`。
- **落位**（纠正过两次）：banner 模板在 `DownloadPanel` 之后、`DescriptionBlock` 之前，且在 `CollapsibleAside` **之外**；post 在右栏底部、article 居中栏、twocol 在左列内。
- **音视频播放器 = 自建控件**（`detail/av-controls.tsx`）：全站禁止再用原生 `controls`。下载入口不单独成行，由 RSC 宿主 `av-player.tsx` 以 `downloadSlot` 注入控件行（用 `MetaDownloadButton` 的 `iconOnly` + `className`；它的**默认翠绿实底路径必须逐字保持**，其余 4 个调用点共用）。控件类名统一在 `cls.ts` 的 `AV_CTRL_*`。
- **`CollapsibleAside` 收起必须「不重排」**：`overflow-hidden` + `<aside>` 两层，内层 `space-y-4 whitespace-nowrap lg:w-[340px]` 锁宽（光裁剪挡不住列宽压 0 → 折行 → 撑开整行）。340 用文件顶部常量 + **完整类名字符串**集中（Tailwind 只扫字面量）。`DetailTwocol` 的 360px `<aside>` 尚未同步加固。
- **VIDEO 只有一个视频**：`av-player` 里 `boxed = isAudio`；模板层对 VIDEO **整块不渲染 `<Gallery>`**（空数组会渲染「暂无预览图」）。落位：`DetailTwocol` 播放器进**主列**；`DetailBanner` 退化成深色标题带；`DetailArticle` 跳过封面 hero。
- **回退不要按目录**：`git checkout HEAD -- <dir>` 会带走该目录所有未提交改动；先 `git diff --stat`。

## 云盘（Graph / OneDrive）
- 凭据：后台运行配置 > `.env`（`GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET`），缺一即整功能关闭、附件回退原存储；app-only，**不能用 `/me/drive`、不支持个人 MSA**。
- **507 = 配额爆了，不是连不通**（`quotaLimitReached`）：同租户里站点盘还能写 ⇒ 租户池没耗尽，问题在**每用户配额**（许可默认 1 TB、管理员最高覆写 5 TB，被重置回默认即此症状；数据不丢、站点转只读）。**后台 `/admin/drives` 的 active 盘指向这种盘 = 新附件全挂**，先切盘再排查。细则见 `REFERENCE.md`。

## IP / 防刷
- IP 取法与哈希**唯一实现** = `src/lib/ip.ts`：`ipFromHeaders()`（`x-forwarded-for` 首段 || `x-real-ip`）、`hashIp()`（`sha256(ip + AUTH_SECRET)` 取 16 位 hex）、`subjectKeyFor()`。新的按 IP 去重/配额必须复用；**别再往 `track/route.ts` 里加内联第二份**（那里曾漏 `x-real-ip` 回退，导致无反代部署下全站共用一个限流桶）。
- `rateLimit(key, limit, periodMs)` 走 Postgres（表缺失自动回退内存 Map），非原子；key 带维度前缀。

## 贡献分 / PIX / 结算
- 命名：**贡献分** = 荣誉层（只增不减，决定等级与结算权重）；**PIX** = 资产层（提现/打赏会减少）；**元** 只在提现页与后台出现。
- 阈值/比例/分值**唯一落点** = `src/lib/points-config.ts`（后台 `/admin/incentive`）；业务模块**不许再写业务数值字面量**。加减 `PointReason` 枚举时 `DEFAULT_SCORES` 的 `satisfies Record<PointReason, number>` 会立刻报错 —— 刻意的编译期护栏，别改宽松。默认只有「难刷」的指标计结算（LIKE/COMMENT/FOLLOWER 默认 `false`）。
- 唯一写入口 = `src/lib/points.ts` 的 `awardPoints()`（永不抛错、P2002 静默）；幂等键 = `@@unique([userId, reason, refId])`。**`refId` 必须把触发者编进去**（`interactionRefId("like", actorId, targetId)`），只写目标 id 会「全站对同一作品永远只加一次分」。
- 自产自销拦截集合 = `NO_SELF_BENEFIT`（点赞/收藏/下载/评论/关注），**不含** PUBLISH/FEATURED/ADMIN_ADJUST/DAILY_LOGIN；判定走 `isSelfBenefit()`。
- **PUBLISH 分有两个发放点，缺一不可**：① `moderation.ts` 的 `approveResourceAction`（actorId = 审核人）；② `actions/resource.ts` 的 `createResourceAction` 直发分支（`directPublish` = `trusted || ADMIN || MODERATOR`，actorId = 本人）。共用幂等键 `(userId, "PUBLISH", resourceId)`；**新增任何「把资源变成 PUBLISHED」的路径必须同步补**（该分支曾漏，2026-09-24 修复）。`restoreResource` 与举报复核 `PENDING→PUBLISHED` **刻意不发**；**存量直发资源不追溯补分**（用户 2026-09-24 决定）。
- **冻结名单唯一事实来源 = `cfg.risk.frozenUserIds`**；`UserPoint.frozen` 列**已删**。绕过冻结必须显式 `awardPoints({ bypassFrozen: true })`。
- 下载防刷：主体去重 + 月配额**只停计分，绝不拦下载**（`download-record.ts`）。
- **两个池别混**：激励池 P = `floor(本期收入 × ratePermille) + carryInFen`（**carryIn 原样并入，不再乘比例** —— 写成 `floor((收入+carryIn)×比例)` 会吞掉 `carryIn×(1−比例)`）；现金池 C = Σ收入 − Σ成本 − Σ已打款 − Σ退款。偿付闸门只认 `coin.ts` 的 `getSolvency()` 一处，前台 `/fund`、结算确认、提现申请、后台水位**必须共用**。
- **结算分只看「当期新增」，不是累计**（`periodScores()`：按 `PointLog.createdAt` 落自然月窗口 + `settleEligible[r]===true` 分组求和）；`minScore`（默认 50）拦的是**当月新增分**，每月清零。榜单/等级看累计分，两处口径别混。**跨期只结转钱、从不结转分**（`carryOutFen → carryInFen` 是纯金额；封顶砍掉的权重与没用完的分数一律作废）。
- 两道闸门不可省：`minScore` 是**资格**门（不够分连 Σscore 都不进）；`minPayoutFen`（默认 500 分 = 5 元 = 500 PIX）是**最小发放额**门（不够则整期不发、全额结转）→ 「结算拿 1 PIX」结构上不可能，1 PIX 只能来自打赏。
- 结算 = **月粒度 + 人工触发**（`period` 只有 `"month"`，`periodKey="YYYY-MM"`，本地时区自然月）。**结转只继承上一期**（`carryInOf` 读 `prevPeriodKey` 且要求 `status !== "DRAFT"`）→ **确认必须按月份先后**。状态机 `DRAFT → CONFIRMED → PAID`，已确认期一律**沿用落库快照、绝不重算**（改它等于事后篡改已公示数字）；未确认月份库里连 `IncentivePeriod` 行都没有。
- **自动结算**（`src/lib/settle-auto.ts` + `instrumentation.ts` + `POST /api/cron/settle`）默认全关（`settlement.autoEnabled=false`）：① 只自动到「入账」，打款永远人工；② **必须按月串行补齐**，任一环中断就 `break`；③ 操作人写 `AUTO_SETTLE_ACTOR="system"`。`confirmPeriod` 撞 `@unique` 抛 P2002 → 当「别人做完了」。容器要 `TZ=Asia/Shanghai` + `tzdata`。
- **封顶副作用**：单人 `capPermille=4000` 长期只有一两人达标 → 每期只发 40%、钱滞留现金池；溢出额**无条件**回流给剩余人 → 池子不够大时低分者也拿满（实测 50 分与 950 分各得 2000）。要改公平性得改 `distribute()` 的回流口径。
- **记账纪律**：`LedgerEntry` **只记真钱进出**（结算分配不进台账）；`WITHDRAW_PAID` **不写 `CoinLedger`**（只 frozen−N、lifetimeWithdrawn+）。金额一律整数分，解析走 `parseYuanToFen()`（录入的 `amountYuan` 是**元**），禁止 `parseFloat*100`；`permilleText(6000) → "60%"`。
- 默认 `coin.perYuan = 100` ⇒ `fenToCoin(amountFen,100) === amountFen`，即池子 PIX 数 = 池子金额分数；**贡献分与 PIX 无固定兑换率**，只有单期一次性间接兑换（`PIX = floor(池子分 × 当月分 ÷ 全站当月分之和)`）。改 `perYuan` 会同时改入账 PIX 与偿付负债 → `fenToCoin` 与 `newLiabilityFen` 必须同源。
- **密钥永不出服务端**：对外走 `publicPaymentConfig()` 的**结构投影**（白名单）。后台表单无密钥保存时提交 `KEEP_SECRET` 哨兵，服务端在 zod 校验**之前**换回库内真值 —— 顺序不能颠倒。
- **防刷缺口**：`NO_SELF_BENEFIT` 只拦本人（`actorId === userId`），**小号互刷拦不住**；可刷面只剩 `FAVORITE_RECEIVED(5)` 与 `DOWNLOAD_RECEIVED(3)`，要收紧只能关掉这两项的 `settleEligible`。
- 后台配置页保存是**整份替换（WYSIWYG）**：表单必须提交完整文档，`safeIncentive()` 用 zod 兜住缺失字段，别改成增量写。

## 首页板块「加载更多」
- 追加方式 = `paged` + `loadMode: "button" | "infinite"`（后台 `/admin/site` 三选）。**别把 `paged` 合并成单字段**（存量 JSON 只有 `paged`）。
- `useLoadMore`（`src/lib/hooks/use-load-more.ts`）page/done 用 ref、并发用 ref 闩；哨兵 effect 依赖要带 `more.length`。

## creators 板块排序（`sort` / `period`）
- `getTopCreators(limit, sort="followers", period="all")`：**默认值就是兼容红线** —— 存量配置只有 `count`，改默认会让不改后台的现网排序被动变化。
- 返回的 `metric` = **驱动本次排名的那个数**，四组合语义不同（`followers`+`week/month` 是**窗口内新增关注数**）。展示必须走同一个 `creatorMetaText(resources, metric, sort, period)`（`src/lib/format.ts`）；写死「粉丝」会把贡献分榜的分数说成粉丝数。
- 配置四处同步：`home-config.ts` / `site-config.ts` 的 `creatorsCfg`、`HomeSectionConfig` 联合、`DEFAULT_*`。后台**两个**编辑器（`home-admin/SectionEditor.tsx`、`site-admin/WidgetEditor.tsx`）都要加控件，漏一个 = 「能存但界面调不了」。

## TypeScript 配置联合的类型陷阱
- 往 `HomeSectionConfig` / `SidebarWidgetConfig` 这类**按 shape 区分的联合**加字段时，若字段名与别的成员重名（creators 的 `sort` vs list 的 `sort`），对象字面量会挑错成员并报看不懂的错：`Type '"followers"' is not assignable to type '"latest"|"popular"|"downloads"'`，或对着 `stats` 的 `Record<string, never>` 报 `Type 'number' is not assignable to type 'never'`。
- 对策：一次把 **schema / 联合类型 / 默认值 / 全部构造点** 补齐并精确匹配。**看到 `never` 的赋值错误，先怀疑 `Record<string, never>` 这个能把任何对象都当候选的成员。**

## 页面标题（metadata）与收录
- **根 layout 的 `title.template`（`%s · 站名`）作用于子段页面**（`/browse` 传 `浏览` → `浏览 · 资源社区`），子段页面写 `title` **不要自己再拼站名**。唯一例外 `app/page.tsx`（拿不到模板，必须自己拼）。
- **`/browse` 的 `page` 是死参数**：`FeedBrowser` 写死 `page = infinite ? 1 : intParam(...)`，而 `/browse` 开无限滚动 → `?page=3` 渲染的仍是第 1 页。所以 canonical **不能带 page**、title **不能带页码**。
- `/browse` 的 title + description + canonical 都随分类变；`cat` **只有命中 `getCategories()` 的真实 slug 才算数**，无效 slug 回落「无分类」并把 canonical 收敛到 `/browse`。
- **每个可收录列表页必须有 h1**（搜索态用 `<h1 className="sr-only">搜索</h1>`）。`ArchiveShell` 只被 `/browse` 与 `/tags/[slug]` 用，h1 走它的 `heading` 槽位；`FeedBrowser` **首页也在用**，h1 **绝不能**加进去。
- description 要和 title 一起做（根 layout 只给**一个**默认描述）。`getCategories()` 是 `cache()` 的 → `generateMetadata` 与页面同请求只查一次库。
