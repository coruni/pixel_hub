# Pixel Hub —— 长期项目约定（常驻红线）

> 只留「改错了会再踩一次」的规则。**细则按主题查同目录 `REFERENCE.md`**：上传体积/图片压缩、附件与音视频上传、云盘 Graph/OneDrive、Markdown 渲染与 Crepe 样式、**详情页落位（四模板）**、**个人主页背景**、打包器追踪、**账务（贡献分/PIX/结算）**、**页面标题与收录**、本机验证环境、水印几何与验证姿势。踩坑经过放 `.workbuddy/memory/YYYY-MM-DD.md`。

## 验证（流程全在 `pixel-hub-verify` skill，开工先加载）
- **禁止浏览器与 CDP**（含 headless、「只量一下」）。可用：tsc/eslint 直调、`prisma/_*.ts(x)` 探针、SSR 契约、铸管理员 cookie 纯 HTTP 抓页面。
- `npm` 在此 bash 里不通（退 127）；`bash` 的 `rm` 是坏 shim，且缺 `ls/grep/head/tail/sleep/dirname` → 查文件用 Read、搜内容用 Grep、批量文件操作用 node 一行脚本。
- 存量 3 条 `no-unused-vars` warning（`admin/media/page.tsx:enumParam`、`auth/PublishForm.tsx:draftCount`、`sidebar/SiteSidebar.tsx:authed`）：别改也别新增。
- **`next build` 预渲染阶段必失败**（`/admin/runtime`、`/_global-error`、`/banned` 报 `Expected workStore to be initialized`）—— 既有问题，编译与 TS 检查是过的。构建不触库（路由全 `ƒ`），别拿「build 过」当「迁移可跳过」的证据。
- **`next dev` 有目录级互斥锁**：第二实例打印 `⨯ Another next dev server is already running` 并退出 → 「端口 ECONNRESET/超时」**不等于**没有实例，先读 `.next/dev/logs/next-development.log`。改 Prisma schema 后必须重启 dev server（旧 client 留在内存：**API 200 + 页面 500** ≈ 进程内 client 陈旧）。
- `DATABASE_URL` 指向**线上 Supabase**（会话池 `connection_limit=5`）：脚本默认只读、退避重试、抓完 `await prisma.$disconnect()`。DB 抖动时鉴权页是「静默重定向」：SSR = **200 + `<meta id="__next-page-redirect">`**（不是 307/500），判据 = 同 cookie 打 `/api/auth/session` 能否拿到 `role`。
- 断言类：canonical 是**绝对 URL** 且 `&` 转义成 `&amp;` → 先 `new URL()` 归一；查 BOM 不能用 `fetch().text()`（剥 U+FEFF）→ `Buffer.from(await r.arrayBuffer())`。**新回归断言必须反证一次**（旧实现下如期变红），否则全绿是假信号。
- 探针 `_` 前缀放 `prisma/`、**用完立即删**；HTTP 层脚本别进仓库，跑完连 admin cookie 一起删。**探针曾被误提交**（`c01bd55`）→ 提交前 `git status --short` 逐行确认，绝不用 `git add -A`。
- **含反引号的长文本别塞进 `node -e "…"`**：双引号里的反引号会被 command substitution **真正执行**（曾凭空造出 `1`、`=20` 垃圾文件；**2026-09-24 又在写工作日志时复发一次**，把 `onDelete: Cascade` 换成了空 → 追加记忆/日志/文档一律用 Write / Edit 工具，别图快走命令行）。

## 编辑纪律（真实踩到过）
- **同一文件的多处改动别放进同一批并行编辑调用**：会互相覆盖且**失败的静默丢失**（工具仍回 "Successfully edited"）。曾丢过 `home.ts` 的 `metricById`、`home-config.ts` 的联合类型、`site-config.ts` 的 meta 描述。规则：**一个文件一次只改一处**，改完 grep + tsc 核对；并行只用于**不同文件**。症状：tsc 报「Cannot find name X」而 X 明明加过 → 先怀疑 import 行被覆盖。
- `.workbuddy/` 受 git 跟踪（**是项目数据，不是缓存**，别删），误删用 `git checkout -- .workbuddy/`；删未提交文件前先 `copyFileSync` 到 `%TEMP%`。

## CSS / 布局
- 单列 grid 必须显式 `grid-cols-1`（= `minmax(0,1fr)`）。裸 `grid gap-1` 的隐式 auto 轨道按 min-content 起算，行内 `truncate` 会撑爆卡片。
- `@import "tailwindcss"` 之后的规则**无层**，优先于任何 `@layer`：与 `* { scrollbar-width:thin }` 冲突时 Tailwind 任意值（中括号）写法被静默压掉 → 用无层普通 class（`.scrollbar-none`）。注释里别原样写中括号类名。
- `overflow-x-auto` 会把 overflow-y 变 auto 并裁自身溢出：横向滚动 + 下划线 tab 的 `-mb-px` 挂在**滚动容器**上。
- **改 class 后必须核 Tailwind 真产出了该类**（postcss 编 `globals.css` 再查选择器，见 skill）。覆盖第三方主题（Crepe）一律 4 层选择器压它的 3 层。

## UI 文案（tip）
- **前台与后台是两套标准**：「配置含义」只属后台（admin `hint` / `sectionHint` / 页首说明框）。前台只留三类 —— **约束**（门槛、金额范围）、**后果**（线下打款、冻结、收入为 0 则池子为 0）、**状态**（已确认 / 已打款）。
- 前台**禁止**：配置数值复述（「安全水位 10% 可用」）、实现说明（「以提交时的比例为准」）、「可在后台配置」、内部术语（`偿付闸门` → 「顺延到收入到账后再处理」）、设计理由、对外提「密钥」。
- 中文 UI 文案**不要用反引号**（会原样渲染，曾被写进 `/creators`）。图标按钮的 `title` 是**无障碍名称**，必留。
- 同一句话别在一个页面里出现两次（页首说明 + 区块 info 块是常见来源）；跨页重复可接受。无限滚动哨兵（`feed/FeedInfinite.tsx`）删文案后必须保留容器高度。

## 破坏性操作 / 评论区楼层树
- **全站禁止原生 `confirm`/`alert`/`prompt`**：统一用 `src/components/ui/feedback.tsx` 的 `confirmDialog()` / `toast()`（全局惰性 host，零 Provider 侵入）。删除类 = 先 `confirmDialog({danger:true})` → 调 action → 结果出 `toast`；**action 的失败原因要能直接 toast**（返回 `error?: string`，别只回 `ok:false`）。确认后立刻进「进行中」态（`disabled` + 「删除中…」）再发请求；`finally` 里无论成败都 `router.refresh()`。
- **评论楼层树的根判定必须与 `rootIdOf` 同一口径**：根 = 无父 **或** 父已被删。`filter(c => !c.parentId)` 会让「父被删的回复」既不是根、也不在任何根的 replies 里 → 整条被静默吞掉。改用 `rootIds = Set(rootIdOf(c) === c.id)`，replies 循环 `if (rootIds.has(c.id)) continue`。
- `Resource.commentCount` 对**每条评论（含回复）**都 `+1`，删一条只 `-1`；改成「连回复一起删」必须同步补扣。

## 详情页（用户明确要过，别改回去）
- 四模板共用 `src/components/resource/detail/parts.tsx`；**描述正文唯一实现 = `DescriptionBlock`**（裸 `<section className="md-body md-body--lg">`，无卡片/底色/边框/小标题，四模板共用）——改描述排版只改这一处。
- **音视频播放器 = 自建控件**（`detail/av-controls.tsx`）：全站禁止再用原生 `controls`；下载入口由 `av-player.tsx` 以 `downloadSlot` 注入控件行（用 `MetaDownloadButton` 的 `iconOnly` + `className`，它的**默认翠绿实底路径必须逐字保持**），控件类名统一在 `cls.ts` 的 `AV_CTRL_*`。
- 模板差异（MUSIC/VIDEO 实走 `post`）、操作条、四处落位、`CollapsibleAside` 锁宽等细节见 `REFERENCE.md` —— **落位被纠正过两次，动之前先查**。
- **回退不要按目录**：`git checkout HEAD -- <dir>` 会带走该目录所有未提交改动；先 `git diff --stat`。

## 云盘 / IP 防刷
- **507 = 配额爆了，不是连不通**（`quotaLimitReached`）。同租户里站点盘还能写 ⇒ 租户池没耗尽，问题在**每用户配额**（OneDrive 许可默认 1 TB、管理员最高覆写 5 TB，被重置回默认即此症状；数据不丢、站点转只读）。**后台 `/admin/drives` 的 active 盘指向这种盘 = 新附件全挂**，先切盘再排查。细则见 `REFERENCE.md`。
- IP 取法与哈希**唯一实现** = `src/lib/ip.ts`（`ipFromHeaders()` / `hashIp()` / `subjectKeyFor()`）。新的按 IP 去重/配额必须复用；**别再往 `track/route.ts` 里加内联第二份**（那里曾漏 `x-real-ip` 回退 → 无反代部署下全站共用一个限流桶）。`rateLimit()` 走 Postgres（表缺失回退内存 Map），非原子，key 带维度前缀。

## 首页 / creators / metadata
- 「加载更多」= `paged` + `loadMode: "button" | "infinite"`（后台 `/admin/site` 三选）。**别把 `paged` 合并成单字段**（存量 JSON 只有 `paged`）。`useLoadMore` 的 page/done 用 ref、并发用 ref 闩；哨兵 effect 依赖要带 `more.length`。
- `getTopCreators(limit, sort="followers", period="all")`：**默认值就是兼容红线** —— 存量配置只有 `count`，改默认会让不改后台的现网排序被动变化。返回的 `metric` = **驱动本次排名的那个数**（`followers`+`week/month` 是**窗口内新增关注**），展示必须走同一个 `creatorMetaText(...)`，写死「粉丝」会把贡献分榜的分数说成粉丝数。配置四处同步：`home-config.ts` / `site-config.ts` 的 `creatorsCfg`、`HomeSectionConfig` 联合、`DEFAULT_*`；后台**两个**编辑器（`home-admin/SectionEditor.tsx`、`site-admin/WidgetEditor.tsx`）都要加控件。
- 页面标题/收录细则（`title.template` 不要再拼站名、`/browse` 的 `page` 是死参数、每个可收录列表页必须有 h1 而 `FeedBrowser` 绝不能加）见 `REFERENCE.md`。

## TS 配置联合的类型陷阱
- 往 `HomeSectionConfig` / `SidebarWidgetConfig` 这类**按 shape 区分的联合**加字段时，若字段名与别的成员重名（creators 的 `sort` vs list 的 `sort`），对象字面量会挑错成员并报看不懂的错：`Type '"followers"' is not assignable to type '"latest"|"popular"|"downloads"'`，或对着 `stats` 的 `Record<string, never>` 报 `Type 'number' is not assignable to type 'never'`。
- 对策：一次把 **schema / 联合类型 / 默认值 / 全部构造点** 补齐并精确匹配。**看到 `never` 的赋值错误，先怀疑 `Record<string, never>`。**

## 账务（贡献分 / PIX / 结算）—— 只列红线，细则见 `REFERENCE.md`
- 阈值/比例/分值**唯一落点** = `src/lib/points-config.ts`（后台 `/admin/incentive`）；业务模块**不许再写业务数值字面量**。加减 `PointReason` 时 `DEFAULT_SCORES` 的 `satisfies Record<PointReason, number>` 会立刻报错 —— 刻意的编译期护栏，别改宽松。
- 唯一写入口 = `src/lib/points.ts` 的 `awardPoints()`；幂等键 `@@unique([userId, reason, refId])`，**`refId` 必须把触发者编进去**（`interactionRefId("like", actorId, targetId)`）。冻结名单唯一事实来源 = `cfg.risk.frozenUserIds`（`UserPoint.frozen` 列**已删**）。
- **PUBLISH 分有两个发放点，缺一不可**（`moderation.ts` 的 `approveResourceAction` + `actions/resource.ts` 的 `createResourceAction` 直发分支）；**新增任何「把资源变成 PUBLISHED」的路径必须同步补**。`restoreResource` 与举报复核 `PENDING→PUBLISHED` **刻意不发**；存量直发资源**不追溯补分**。
- 结算 = **月粒度 + 人工触发**，分只看**当期新增**（不是累计），**跨期只结转钱、从不结转分**，**确认必须按月份先后**；已确认期**沿用落库快照、绝不重算**。后台配置页保存是**整份替换（WYSIWYG）**，别改成增量写。

## 图片水印（`src/lib/media/watermark.ts`）
- **只有两条链路打水印**：① `/api/upload` → `processImage()`（发布向导/后台改稿图集 + **Markdown 编辑器正文插图**）；② 评论附图 `social.ts` 的 `saveCommentImage()`。**明确不打**：头像 `uploadAvatarAction`、hero 横幅 `uploadHeroAction`、后台直传 `admin-media.ts`（原图直存）、附件大文件通道。新增图片入口先归类。
- 开关是**用户级偏好**（`User.watermarkImages` 默认 false、`watermarkText` 可空 = 兜底 `@用户名`），取的是**当前登录者** → 管理员替人改稿时会带上自己的水印。
- **字体 = 前台那份 Fusion Pixel**，fontkit 取字形轮廓渲成 SVG `<path>`（不装系统字体、不依赖 fontconfig ⇒ 本机与线上逐像素一致）。样式必须**深填充 + 浅描边**（反过来在暖白底上是空心字）；放不下**缩字号、不设下限**（下限会把「缩不下」变成「裁字」）。
- 开印时原图按**原始格式**重编码（`encodeOriginal()`），`media.size` 语义随之变「落盘文件」；**GIF 不重编码**、极端宽高比静默跳过。`process.ts` **不要再拦一道 `watermarkAvailable()`**（那是 fontconfig 回退路径的检查，会误伤轮廓模式）。**fontkit 没有 default 导出** → 必须 `import * as` + `next.config.ts` 的 `serverExternalPackages`，tsx 探针抓不到这个坑、只有真起 dev server 才暴露。
- 几何、字体身份、逐像素验证姿势见 `REFERENCE.md`。

## 个人主页背景（`.profile-bg-pc`）—— 只列红线
- **一张图、一个槽、仅桌面端**：字段 `User.profileBgPcKey`（迁移 `0009`），元素 `hidden sm:block`。**移动端那版是用户明确砍掉的（2026-09-24），不要再加回来**；`slot` 参数已废。
- **门槛在激励配置**（`incentive.profile.bgMinLevel`，等级序号）、**尺寸上限在上传限制**（`profileBgMaxMb`）——两处刻意分开。唯一判定函数 = `upload-config.ts` 的 `profileBgUnlocked()`，前台/设置页/action 三处共用，**action 里必须重算**。
- 遮罩只有 `globals.css` 的 `.profile-bg-pc` 一份，**设置页预览直接套这个类**（不要复刻渐变）；层是 `fixed inset-0 -z-10` + `aria-hidden`，不参与布局、不盖 hero。
- 细节与「必须临时造条件才能验」的姿势见 `REFERENCE.md`。
