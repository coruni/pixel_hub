# Pixel Hub —— 长期项目约定（常驻规则）

> 只留「改错了会再踩一次」的规则；踩坑经过放 `.workbuddy/memory/YYYY-MM-DD.md`。
> **动手前按主题查细则**（下面这份只放高频红线，细则在 `REFERENCE.md`）：
> 上传/图片压缩/音视频、Markdown 编辑器与 Crepe 样式、打包器文件追踪、**本机验证环境（跑 build/tsc/浏览器量测）** → 见同目录 `REFERENCE.md`。

## CSS / 布局
- 单列 grid 必须显式 `grid-cols-1`：裸 `grid gap-1` 的隐式 auto 轨道按 min-content 起算，行内 `truncate` 会撑爆卡片。
- `globals.css` 里 `@import "tailwindcss"` 之后的规则**无层**，优先于任何 `@layer` → Tailwind 任意值（中括号）写法被静默压掉，写无层普通 class。
- `overflow-x-auto` 会把 overflow-y 变 auto 并裁自身：下划线 tab 的 `-mb-px` 挂**滚动容器**。

## UI 文案
- **前台/后台两套标准**：「配置含义」只属后台（admin `hint`/`sectionHint`/页首说明框）；前台只留**约束/后果/状态**三类。
- 前台**禁止**：配置数值复述、实现说明（「以提交时的比例为准」「兑换比例 100 PIX/元」）、「可在后台配置」、内部术语（`偿付闸门`→「顺延到收入到账后再处理」）、设计理由、对外提「密钥」。
- 中文 UI 文案**不用反引号**（原样渲染）。图标按钮的 `title` 是**无障碍名称**，必留。
- 同一句话别在一页出现两次；跨页重复可接受。无限滚动哨兵（`feed/FeedInfinite.tsx`）删文案后必须保留容器高度。

## 破坏性操作 / 评论区楼层树
- **全站禁止原生 `confirm`/`alert`/`prompt`**：用 `src/components/ui/feedback.tsx` 的 `confirmDialog()`/`toast()`。删除类 = `confirmDialog({danger:true})` → action → `toast`；**action 失败原因要能直接 toast**（返回 `error?: string`）。确认后立刻进「进行中」态再发请求；`finally` 里无论成败都 `router.refresh()`。
- **评论根判定必须与 `rootIdOf` 同口径**：根 = 无父 **或** 父已被删。`filter(c => !c.parentId)` 会让「父被删的回复」既不进根、也不进任何根的 replies，整条被静默吞掉。写成 `rootIds = Set(rootIdOf(c) === c.id)`，replies 循环 `if (rootIds.has(c.id)) continue` 排除自身。
- `Resource.commentCount` 对**每条评论（含回复）**都 `+1`，删一条只 `-1`；改成「连回复一起删」必须同步补扣。

## 详情页操作条（用户明确要过）
- 形态 = **图标 + 文字**（Heart/Star/Flag/Pencil，`size={15}`，`aria-hidden`）；无图标版已被否。`ACTION_TEXT`（`src/lib/ui/cls.ts`）：无边框无底色。`FollowButton` 是全站唯一保留描边/实底的动作。
- `ActionBar` 行容器 `justify-end`；状态走文案 + 颜色双通道。
- **落位**（纠正过两次）：banner 模板在 `DownloadPanel` 之后、`DescriptionBlock` 之前，且在 `CollapsibleAside` **之外**；post 在右栏底部、article 居中栏、twocol 在左列内。
- **`CollapsibleAside` 收起必须「不重排」**：`overflow-hidden` + `<aside>` 两层，内层 `whitespace-nowrap lg:w-[340px]` 锁宽；340 用文件顶部常量 + **完整类名字符串**（Tailwind 只扫字面量）。`DetailTwocol` 的 360px `<aside>` 尚未同步加固。

## 详情页模板（高发改动区）
- 四模板共用 `src/components/resource/detail/parts.tsx`；`detailTemplate.byType` 后台可配（信息面板标题不能写死）。
- **回退不要按目录**（`git checkout HEAD -- <dir>` 会带走该目录所有未提交改动），先 `git diff --stat`。
- **VIDEO 只有一个视频**：`av-player` 里 `boxed = isAudio`；模板层对 VIDEO **整块不渲染 `<Gallery>`**（空数组会渲染「暂无预览图」）。落位：`DetailTwocol` 播放器进**主列**；`DetailBanner` 退化成深色标题带；`DetailArticle` 跳过封面 hero。
- **音视频在 OneDrive 也要能播**：`/od` 按扩展名分流 —— 音视频走代理转发（自定 MIME + `Content-Disposition: inline` + `Accept-Ranges`，`Range`/`Content-Range` **必须透传**，206 原样返回），其余 302 预鉴权地址。
- 测「路径穿越」别用 HTTP 客户端（fetch/undici 与 Next 路由会**先折叠 `..`**）。

## IP / 防刷
- IP 取法与哈希**唯一实现** `src/lib/ip.ts`：`ipFromHeaders()`（`x-forwarded-for` 首段 || `x-real-ip`）、`hashIp()`（`sha256(ip + AUTH_SECRET)` 取 16 位 hex）、`subjectKeyFor()`。新配额必须复用，**别再往 `track/route.ts` 加内联第二份**。
- `rateLimit(key, limit, periodMs)` 走 Postgres（表缺失回退内存 Map），非原子；key 带维度前缀。

## 贡献分 / PIX / 结算
- 命名：**贡献分** = 荣誉层，只增不减，决定等级与结算权重；**PIX** = 资产层，会因提现/打赏减少；**元** 只在提现页与后台。「激励池 P」= 本期应发额，「现金池 C」= 站上真钱。
- 贡献分**唯一写入口** `src/lib/points.ts` 的 `awardPoints()`（永不抛错、P2002 静默）；幂等键 `@@unique([userId, reason, refId])`，**`refId` 必须把触发者编进去**（`interactionRefId()`）。
- 自产自销拦截 `NO_SELF_BENEFIT`（点赞/收藏/下载/评论/关注），**不含** PUBLISH/FEATURED/ADMIN_ADJUST/DAILY_LOGIN；走 `isSelfBenefit()`。
- 阈值/比例/分值**唯一落点** `src/lib/points-config.ts`（后台 `/admin/incentive`）；业务模块不许写业务数值字面量。`satisfies Record<PointReason, number>` 是刻意护栏。默认只有「难刷」的指标计结算（LIKE/COMMENT/FOLLOWER 默认 `false`）。
- **PUBLISH 分两个发放点，缺一不可**：① `moderation.ts` 的 `approveResourceAction`；② `actions/resource.ts` 的 `createResourceAction` 直发分支（`trusted || ADMIN || MODERATOR`）。共用幂等键 `(userId,"PUBLISH",resourceId)`。**新增任何「把资源变成 PUBLISHED」的路径必须补这条**。`restoreResource` 与举报复核 `PENDING→PUBLISHED` **刻意不发**；存量直发不追溯补分（用户 2026-09-24 决定）。`prisma/backfill-points.ts` 同口径。
- 下载防刷：主体去重 + 月配额**只停计分，绝不拦下载**（`download-record.ts`）。
- 后台配置保存是**整份替换（WYSIWYG）**：表单必须提交完整文档，`safeIncentive()` 用 zod 兜缺失字段，别改成增量写。
- **冻结名单唯一来源 `cfg.risk.frozenUserIds`**；`UserPoint.frozen` 列**已删**。绕过冻结必须显式 `awardPoints({ bypassFrozen: true })`。
- **两个池别混**：激励池 P = `floor(本期收入 × ratePermille) + carryInFen`（**carryIn 原样并入，不再乘比例** —— 写成 `floor((收入+carryIn)×比例)` 会吞掉 `carryIn×(1−比例)`）；现金池 C = Σ收入 − Σ成本 − Σ已打款 − Σ退款。偿付闸门只认 `coin.ts` 的 `getSolvency()`，前台 `/fund`、结算确认、提现申请、后台水位**必须共用**。
- **记账纪律**：`LedgerEntry` **只记真钱进出**（结算分配不进台账）；`WITHDRAW_PAID` **不写 `CoinLedger`**（只 frozen−N、lifetimeWithdrawn+）。
- **密钥永不出服务端**：对外走 `publicPaymentConfig()` 投影。后台无密钥保存提交 `KEEP_SECRET` 哨兵，服务端在 zod 校验**之前**换回库内真值 —— 顺序不能颠倒。
- `permilleText(n)` 去掉无意义小数（`6000→"60%"`）；金额一律整数分，解析走 `parseYuanToFen()`，禁止 `parseFloat*100`。收入录入的 `amountYuan` 是**元**。
- **结算分只看「当期新增」，不是累计**：`periodScores()`（`settle.ts:82`）按 `PointLog.createdAt` 落自然月窗口 + `settleEligible[r]===true` 分组求和。`minScore`（默认 50）拦的是**当月新增分**，每月清零；榜单/等级看累计分，两处口径别混。老作品的**新**收藏/新下载仍在窗口产生新分（长尾是刻意设计）；同一人对同一作品的收藏/下载**永久只计一次**。**跨期只结转钱、从不结转分**：`carryOutFen → carryInFen` 是纯金额，封顶砍掉的权重与当月没用完的分数一律作废（累计分只服务等级/榜单），所以「上期 950 分的人」下期必须重新赚分才参与分配。
- 默认 `coin.perYuan = 100` ⇒ `fenToCoin(amountFen,100) === amountFen`，即 **1 分**钱 = 1 PIX**（池子 PIX 数 = 池子金额分数）。这里的「分」是货币最小单位，**与贡献分毫无换算关系**。改 `perYuan` 会同时改入账 PIX 与偿付负债，`fenToCoin` 与 `newLiabilityFen` 必须同源。
- **贡献分与 PIX 无固定兑换率**，只有单期一次性间接兑换：`PIX = floor(池子分 × 你的当月分 ÷ 全站当月分之和)`。文档里「100 PIX/元」是 **PIX↔元**。
- 两道闸门不可省：`minScore` 是**资格**门（不够分连 Σscore 都不进）；`minPayoutFen`（默认 500 分 = 5 元 = 500 PIX）是**最小发放额**门（不够则整期不发、全额结转）。故「结算拿 1 PIX」结构上不可能，最小结算单位 500 PIX；1 PIX 只能来自打赏。
- 结算是「月粒度 + 人工触发」：`settlement.period` 只有 `"month"`，`periodKey="YYYY-MM"`，窗口按 `periodRange()` 的**本地时区**自然月。`confirmPeriod()` 由后台 Server Action 触发；未确认的月份库里连 `IncentivePeriod` 行都没有（后台看的是 `buildDraft()` 现算预览）。
- **结转只继承上一期**（`carryInOf` 读 `prevPeriodKey` 且要求 `status !== "DRAFT"`）→ **确认必须按月份先后**，先 9 月再补 8 月的话 8 月的 `carryOutFen` 永远进不了 9 月。没录 `RevenueEntry` 则池子 0、`canConfirm` false。
- 状态机 `DRAFT → CONFIRMED → PAID`。已确认期一律**沿用落库快照、绝不重算**（`buildDraft` 的 `if (existing)` 分支；改它等于事后篡改已公示数字）。闸门不过 + `insufficientStrategy="reject"`（默认）→ 整期拒绝。
- **自动结算**（`src/lib/settle-auto.ts` + `src/instrumentation.ts` + `POST /api/cron/settle`）默认全关（`settlement.autoEnabled=false`）。三条纪律：① 只自动到「入账」，打款永远人工；② **必须按月串行补齐**（`carryInOf` 只认上一期），任一环中断就 `break` 等下轮，只有「无发放明细」才跳过；③ 操作人写 `AUTO_SETTLE_ACTOR="system"`（`AuditLog.adminId`/`confirmedBy` 无外键）。`confirmPeriod` 撞 `@unique` 抛 P2002，调度器当「别人做完了」。容器必须 `TZ=Asia/Shanghai` + 装 `tzdata`。
- **单人封顶 `capPermille=4000` 的副作用**：长期只有一两人达标时每期只发 40%、60% 全额结转 → 钱长期滞留（仍在现金池 C）。缓解靠调高 cap 或降低 `minScore`。
- **封顶回流的副作用**（2026-09-24 实测 `allocate()`）：溢出额**无条件**回流给剩余人并按分权重分完 → 池子不够大时低分者也能拿满封顶（我 50 分与对手 950 分各得 2000）。要改公平性就得改 `distribute()` 的回流口径。
- **防刷缺口**：`NO_SELF_BENEFIT` 只拦本人（`actorId === userId`），**小号互刷拦不住**；可刷面只剩 `FAVORITE_RECEIVED(5)` 与 `DOWNLOAD_RECEIVED(3)`，要收紧只能在后台关掉这两项的 `settleEligible`。

## 首页板块「加载更多」
- 追加方式 = `paged` + `loadMode: "button" | "infinite"`（后台 `/admin/site` 三选）。**别把 `paged` 合并成单字段**（存量 JSON 只有 `paged`）。
- `useLoadMore`（`src/lib/hooks/use-load-more.ts`）page/done 用 ref、并发用 ref 闩；哨兵 effect 依赖要带 `more.length`。

## creators 排序（`sort` / `period`）
- `getTopCreators(limit, sort="followers", period="all")`：**默认值就是兼容红线**（存量配置只有 `count`）。
- 返回的 `metric` = **驱动本次排名的那个数**（`followers`+`week/month` 是窗口内新增关注数）。展示必须走 `creatorMetaText()`（`src/lib/format.ts`）。
- 配置四处同步：`home-config.ts`/`site-config.ts` 的 `creatorsCfg`、`HomeSectionConfig` 联合、`DEFAULT_*`；后台**两个**编辑器（`home-admin/SectionEditor.tsx`、`site-admin/WidgetEditor.tsx`）都要加控件，漏一个 = 「能存但界面调不了」。

## TS 配置联合的类型陷阱
- 往**按 shape 区分的联合**（`HomeSectionConfig`/`SidebarWidgetConfig`）加字段时，若字段名与别的成员重名，对象字面量会挑错成员并报看不懂的错（或对着 `Record<string, never>` 报 `not assignable to never`）。对策：schema/联合/默认值/全部构造点一次补齐精确匹配。**看到 `never` 赋值错误，先怀疑 `Record<string, never>` 成员。**

## metadata 与收录
- 根 layout 的 `title.template`（`%s · 站名`）**作用于子段页面**，子页面写 `title` 不要自己拼站名；**唯一例外** `app/page.tsx`。
- **`/browse` 的 `page` 是死参数**（无限滚动写死 `page=1`）→ canonical **不能带 page**、title **不能带页码**；title/description/canonical 都随**分类**变，`cat` 只有命中 `getCategories()` 的真实 slug 才算数，无效 slug 收敛 canonical 到 `/browse`。
- **每个可收录列表页必须有 h1**；搜索态用 `<h1 className="sr-only">搜索</h1>`。`ArchiveShell` 只被 `/browse` 与 `/tags/[slug]` 用，h1 走其 `heading` 槽；`FeedBrowser` **首页也在用**，h1 **绝不能**加进去。
- description 要和 title 一起做（根 layout 只给一个默认描述）。`getCategories()` 是 `cache()` 的。

## 临时脚本 / 编辑纪律
- 验证脚本一律 `_` 前缀放 `prisma/`，**用完立即删**；删未提交文件前先 `copyFileSync` 到 `%TEMP%`。HTTP 层脚本**别写进仓库**，跑完连 admin cookie 一起删。
- **探针曾被误提交**（`c01bd55`）→ 提交前必须 `git status --short` 逐行确认，**只 add 本次任务的文件**，绝不用 `git add -A`。
- `.workbuddy/` 是项目数据**不是缓存**、受 git 跟踪；误删用 `git checkout -- .workbuddy/` 恢复。
- **同一文件的多处改动别放进同一批并行编辑**：会互相覆盖且**失败的静默丢失**（工具仍回 Successfully edited）。规则：一个文件一次只改一处，批量改完回头核对（grep / tsc）；并行只用于**不同文件**。
