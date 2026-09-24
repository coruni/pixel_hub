# Pixel Hub —— 长期项目约定

> 只留「改错了会再踩一次」的规则；操作流程在 `pixel-hub-verify` skill，踩坑经过放 `.workbuddy/memory/YYYY-MM-DD.md`。

## 验证：常驻事实（流程见 skill）
- **开工先加载 `pixel-hub-verify` skill**（`C:\Users\Amiya\.workbuddy\skills\pixel-hub-verify\SKILL.md`）—— tsc/eslint 直调、`prisma/_*.ts` 探针、SSR 契约探针、铸管理员 cookie 抓页面全在里面，别重新摸索。**禁止浏览器与 CDP**。
- 静态检查：`node node_modules/typescript/bin/tsc --noEmit` + `node node_modules/eslint/bin/eslint.js src`（**`npm` 在此 bash 里不通**，退 127）。存量 3 条 no-unused-vars warning（`admin/media/page.tsx:enumParam`、`auth/PublishForm.tsx:draftCount`、`sidebar/SiteSidebar.tsx:authed`）：别改也别新增。
- **`next build` 预渲染阶段必失败**（`/admin/runtime`、`/_global-error`、`/banned` 报 `Expected workStore to be initialized`，worker exit 1）—— 既有问题，编译与 TS 检查是过的。构建不触库（路由全 `ƒ`），别拿「build 过」当「迁移可跳过」的证据。
- **`next dev` 有目录级互斥锁**：第二实例打印 `⨯ Another next dev server is already running` 并退出 → 「端口 ECONNRESET/超时」不等于没有实例，先读 `.next/dev/logs/next-development.log`。改 Prisma schema 后必须重启 dev server（旧 client 在内存里：**API 200 + 页面 500** ≈ 进程内 client 陈旧）。
- `DATABASE_URL` 指向**线上 Supabase**，会话池 `connection_limit=5`：dev 长驻占满时 Prisma 首连报 `Can't reach database server` 而裸 TCP 通 → 脚本退避重试（~8×1.2s）、抓完 `await prisma.$disconnect()` 让路。探测脚本默认只读。
- DB 抖动时鉴权页是「静默重定向」：SSR = **200 + `<meta id="__next-page-redirect" content="1;url=/admin">`**（不是 307/500）。别当权限 bug 追，判据 = 同 cookie 打 `/api/auth/session` 能否拿到 `role`。
- 断言类：canonical 输出**绝对 URL** 且 `&` 转义成 `&amp;` → 先 `new URL()` 归一；查 BOM 不能用 `fetch().text()`（剥 U+FEFF）→ `Buffer.from(await r.arrayBuffer())`。**新回归断言必须反证一次**（旧实现下如期变红），否则全绿是假信号。
- 脚本 `_` 前缀放 `prisma/`、**用完立即删**；HTTP 层脚本别进仓库，跑完连 admin cookie 一起删。**探针曾被误提交**（`c01bd55`）→ 提交前 `git status --short` 逐行确认，绝不用 `git add -A`。`.workbuddy/` 受 git 跟踪，误删用 `git checkout -- .workbuddy/`。
- **写含反引号的长文本别塞进命令行**：bash 里 `node -e "…"` 的双引号中，反引号会被 command substitution **真正执行**（文本被替换成命令输出，且反引号内的字符串被当命令跑）—— 曾凭空造出 `1`、`=20` 等垃圾文件。一律用 Write 工具落临时文件，再让 node 读。

## 编辑纪律（真实踩到过）
- **同一文件的多处改动不要放进同一批并行编辑调用**：会互相覆盖且**失败的静默丢失**（工具仍回 "Successfully edited"）。曾丢过 `home.ts` 的 `metricById`、`home-config.ts` 的联合类型、`site-config.ts` 的 meta 描述。规则：**一个文件一次只改一处**，批量改完回头核对（grep + tsc）；并行只用于**不同文件**。症状：tsc 报「Cannot find name X」而 X 明明加过 → 先怀疑 import 行被覆盖。

## CSS 布局
- 单列 grid 必须显式 `grid-cols-1`（= `minmax(0,1fr)`）。裸 `grid gap-1` 的隐式 auto 轨道按 min-content 起算，行内 `truncate` 会撑爆卡片；`min-w-0`/`truncate` 只加行内层压不住。
- `globals.css` 中 `@import "tailwindcss"` 之后的规则**无层**，优先于任何 `@layer`：与 `* { scrollbar-width:thin }` 冲突时 Tailwind 任意值（中括号）写法被静默压掉 → 用无层普通 class（`.scrollbar-none`）。注释里别原样写中括号类名。
- `overflow-x-auto` 会把 overflow-y 变 auto 并裁自身溢出：横向滚动 + 下划线 tab 的 `-mb-px` 挂在**滚动容器**上。
- **改 class 后必须核 Tailwind 真产出了该类**（用 postcss 编 `globals.css` 再查选择器，见 skill），否则样式静默丢失、看源码毫无破绽。

## 图片压缩与上传体积
- 压缩一律走 `src/lib/media/compress.ts` 的 `compressWith()`，禁止直接 `.webp()/.jpeg()/.png()`。alpha：webp 锁 `alphaQuality:100`；png `quality<100` 用 `palette:true`、`=100` 无损；jpg 先 `flatten({background:"#ffffff"})`（否则透明变黑）。参数取自 `SiteSetting["uploadLimits"]`（后台 `/admin/uploads`）；缩略图质量 = 主图 − 8（下限 40）。落盘 key 扩展名必须与输出格式一致。
- **存储口径恒为整数 MB**（`attachmentMaxMb` 等），单位只活在输入层与展示层。展示**唯一落点** = `src/lib/upload-config.ts` 的 `sizeText(mb)`，前台再套 `mbText()` 加「≤」；**禁止任何地方再写 `mb/1024` 裸折算**（曾把 1500MB 渲成 `1.46484375GB`）。GB 只在 **`mb % 512 === 0`**（`GB_ALIGN_MB`）时启用，`fromMb()` 与 `sizeText()` 必须同规则，否则输入框单位与概览卡打架。
- 后台附件上限 = 数值输入 + 单位下拉（draft 拆 `attachmentSize` + `attachmentUnit`）；换单位走 `changeUnit()` 无损折算（MB→GB 用 `.toFixed(4)`）；非法输入时保存按钮必须 `disabled`。图片四档（1–100MB）不给单位选择。

## 附件 / 音视频上传（改动前必读）
- 唯一上传按钮 = `src/components/upload/AttachmentUpload.tsx`；全站禁止再手写 `<label>`+`<input type=file>`。四态：可上传 / 拖拽悬停（`dragging`+`dropProps`）/ 上传中（`progress`）/ 已回执（`filled`）。
- **别自己造 FileList**（`FileList` 没有 `Symbol.iterator`，索引访问器长在 prototype 上）：`Object.create(FileList.prototype)` + 补索引的替身会让 `Array.from(fl)` 只探到 `length === 0` → 恒返回 `[undefined]`（曾导致 `/upload` 粘贴多张只出一张）。自造必须显式挂 `Symbol.iterator`，见 `use-file-paste.ts` 的 `asFileList()`；`useFileDrop` 透传宿主 `dataTransfer.files` 无此问题。
- `accept` 按 kind 分派：MUSIC/VIDEO **必须**传 `avAcceptAttr(kind)`。进度别混用：单文件字节进度用 `percent`；`progress({done,total})` 是**批量**语义。清空 `input.value` 必须在 `onFiles` **之后**。
- 清单编辑器 = `AttachmentListEditor`。`variant="dropzone"` 投放区，上传与抽屉**解耦**；`useFileDrop({disabled})` 只挂 `rows.length>=20`、**不挂 busy**；计数用 `doneRef`/`totalRef`。抽屉草稿模型（`open` 编辑 / `draft` 新增互斥），上传回调读 `drawerHeldRef`（async 闭包读 state 是旧值）。
- 提交闸门 `onBusyChange(inflight)` → 宿主禁用提交 + `<form onSubmit>` 里 `preventDefault()` 兜回车。**新增带附件清单的表单必须接。**
- `av-section.tsx`（MUSIC/VIDEO）是单文件直传（写 `avUrl`），不套草稿模型：`dropzone` + `useFileDrop({disabled: uploading})`；**必须接 `onBusyChange`**。
- **字段错误 key 是 `url` 不是 `avUrl`**；GAME/ARTICLE 是 `downloads`、IMAGE 是 `mediaIds`。读错 key 错误被静默吞、页面「点了没反应」。
- 回执不能等 `probeFile()`（最坏 12s）：先出回执，probe 结果异步补提示。视频自动封面 `capturePoster()` 抽 **10% 处**那帧（首帧常纯黑）；`autoCoverId` ref —— 自动值可覆盖自动值，用户手选过就不抢。
- 大文件通道：`/attachment/session` 三态（云盘分片 / `{mode:"driver"}` 流式直传 / `409 NO_CLOUD` 回退旧单请求）。旧 `/attachment` 走 `formData()`（整请求体进内存，硬限 250MB），`Content-Length` 预检必须在 `formData()` **之前**。流式直传 `PUT /api/upload/attachment/stream`：`localDriver.putStream` 先写 `.uploads-tmp/`（不在 public 下、不放 `os.tmpdir()` —— 跨盘 rename EXDEV）再 rename。能力用 `streamCapable()` 判（s3/chevereto 无 `putStream` → 仍 250MB）。客户端进度**只能用 XHR**。

## 云盘（Graph / OneDrive）`src/lib/storage/onedrive.ts`
- 凭据：后台运行配置 > `.env`（`GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET`），缺一即整功能关闭、附件回退原存储。app-only，**不能用 `/me/drive`，不支持个人 MSA**。
- locator 白名单 `drives|sites|users|groups/`。形态：`drives/{id}`、`sites/{siteId}/drive`、`sites/{host}:/sites/{team}:/drive`、`users/{UPN}/drive`。
- **507 = 配额爆了，不是连不通**。Graph 体 `{"error":{"code":"quotaLimitReached"}}`；先 `GET /v1.0/{locator}?$select=id,name,driveType,quota` 看 `quota.state`（`exceeded`）/`remaining`。用户盘 `total` 被下调（如 10 GiB）而 `used` 远超它（如 2.27 TiB）会长期 507；**同租户里站点盘还能写就说明租户池没耗尽，问题在每用户配额**（OneDrive 许可默认 1 TB、管理员最高覆写 5 TB，被重置回默认即此症状；站点转只读、数据不丢）。判定许可/池状态 **Graph 拿不到**（`/users`、`/subscribedSkus`、`/admin/sharepoint/settings` 全 403），要去 SharePoint 管理中心看。**后台 `/admin/drives` 的 active 盘指向这种盘 = 新附件全挂**，先切盘再排查。
- `graphErr()` 给 403/404/429/507 都补中文 hint；**新增状态码提示加在这里**，别在调用点各写一份。
- 引用语义 `/od/{driveId}/{itemPath}`，`itemPath = [rootPath/]YYYYMM/{安全原名}_{uuid}.{ext}`，**存储名必须保留原名**（Graph 下载响应的 `Content-Disposition` 用的是云盘存储名，否则用户下到随机 uuid 名）。`rootPath` 只影响新上传落点，存量引用自带完整路径。
- 音视频要能内联播：`/od` 按扩展名分流 —— 音视频走本站代理转发（自定 MIME + `Content-Disposition: inline` + `Accept-Ranges`，`Range`/`Content-Range` **必须透传**，206 原样返回），其余 302 预鉴权地址。

## ImageViewer（`src/components/ui/ImageViewer.tsx`）
- 平移按「可平移空间」（`panBounds`/`canPan`）判，不用 `zoom > 1` 当代理；位移必须在 `applyZoom`/`rotateBy` 后重新夹取。
- react-hooks v7 immutability：`useCallback`/`useEffect` 内不许写 `useRef.current`（只有 `useLayoutEffect` 可以）。

## UI 文案（tip）
- **前台与后台是两套标准**：「配置含义」只属于后台（admin `hint` / `sectionHint` / 页首说明框）。前台只留三类 —— **约束**（门槛、金额范围）、**后果**（线下打款、冻结、收入为 0 则池子为 0）、**状态**（已确认 / 已打款）。
- 前台**禁止**：配置数值复述（「安全水位 10% 可用」）、实现说明（「以提交时的比例为准」）、「可在后台配置」、内部术语（`偿付闸门` → 「顺延到收入到账后再处理」）、设计理由、对外提「密钥」。
- 中文 UI 文案**不要用反引号**（会原样渲染，曾被写进 `/creators`）。只讲「怎么操作」且已由可见控件表达的文案＝多余。图标按钮的 `title` 是**无障碍名称**，必留。
- 同一句话不要在一个页面里出现两次（页首说明 + 区块 info 块是常见来源）；跨页重复可接受。无限滚动哨兵（`feed/FeedInfinite.tsx`）删文案后必须保留容器高度，否则 IntersectionObserver 目标塌陷。

## Markdown 渲染与编辑器（`rte/Markdown.tsx` + `rte/MdEditor.tsx`）
- 渲染端唯一实现 = `src/components/rte/Markdown.tsx`（react-markdown），**默认不渲染原始 HTML**——安全默认，别为某个标签加 `rehype-raw`。全站 4 个调用点都走它。
- **裸写的 `<br>` 会被转义成文本**（来源是从别处粘贴/迁移的内容）。修法：内联 `remarkBrAsBreak` 插件把 mdast 的 `html` 节点（值为 br）换成 `break` 节点（搜 `BR_TAG`）。Milkdown 按 Shift+Enter 产出的**反斜杠硬换行**本就能渲染成 `<br>`，不要动；`<script>` 之类仍然转义。
- 编辑器 = Milkdown Crepe；排版基准 = **前台 `.md-body--lg`**（详情页 15px），所见 = 发布后所得。
- **覆盖 Crepe 主题必须用 4 层选择器**（`.md-editor .milkdown .ProseMirror X`）压过它的 3 层，这样不依赖「crepe CSS 与 globals.css 谁先加载」。
- Crepe 的 `reset.css` 是「大标题文档」风（h1/h2/h3 = 2.625/2.25/2em、标题 `font-weight:400`、段落 `padding:4px 0`），对齐时字号/字重/行高/边距要**一起压**，只改字号会留下假一致。
- **h5/h6 前台完全没有规则**（`.md-body` 只写到 h1~h4、字号只到 h3），编辑器里必须显式重置成 `inherit`，否则比发布后重一圈；首尾元素还要补 `> :first-child/:last-child` 零边距。
- 代码字体栈唯一来源 = `:root` 的 `--md-font-code`。
- 已对齐：h1~h6 / p / ul / ol / li::marker / a(含 hover) / strong / code / pre / blockquote / hr / 首尾边距。**未对齐**：表格（Crepe 表格是带拖拽手柄的交互 widget）、docs 编辑器（前台 13px vs 编辑器 15px）。

## 破坏性操作 / 评论区楼层树
- **全站禁止原生 `confirm`/`alert`/`prompt`**：统一用 `src/components/ui/feedback.tsx` 的 `confirmDialog()` / `toast()`（全局惰性 host，零 Provider 侵入）。删除类 = 先 `confirmDialog({danger:true})` → 调 action → 结果出 `toast`。**action 的失败原因要能直接 toast**（返回 `error?: string`，别只回 `ok:false`）。
- 确认后立刻进「进行中」态（`disabled` + 文案换「删除中…」）再发请求；`finally` 里无论成败都 `router.refresh()`。
- **评论楼层树的根判定必须与 `rootIdOf` 同一口径**：根 = 无父 **或** 父已被删。`getResourceDetail` 曾用 `filter(c => !c.parentId)` 当根 → 「父被删的回复」**既不是根、也不在任何根的 replies 里，整条被静默吞掉**（页面看不到，库里仍 PUBLIC）。改成 `rootIds = Set(过滤 rootIdOf(c) === c.id)`，replies 循环用 `if (rootIds.has(c.id)) continue` 排除自身。
- `Resource.commentCount` 对**每条评论（含回复）**都 `+1`，删一条只 `-1` → 「删根 → 回复升格」计数天然对得上；若改成「连回复一起删」必须同步补扣。

## 详情页（用户明确要过，别改回去）
- 四模板共用 `src/components/resource/detail/parts.tsx`；`detailTemplate.byType` 后台可配（信息面板标题不能写死）。
- **音视频播放器 = 自建控件**（`detail/av-controls.tsx`）：全站禁止再用原生 `controls`（改造前那套已被否）。下载入口不单独成行，由宿主 `av-player.tsx`（RSC）以 `downloadSlot` 注入播放器控件行 —— 用 `MetaDownloadButton` 的 `iconOnly` + `className`；它的**默认翠绿实底路径必须逐字保持**（其余 4 个调用点共用）。控件类名统一在 `src/lib/ui/cls.ts` 的 `AV_CTRL_*`。
- **MUSIC / VIDEO 实际走 `post` 模板**（`detailTemplate` 内置 byType 只给 GAME=banner、ARTICLE=article）。`DetailBanner` 的音频紧凑首屏要后台配成 banner 才生效；post 下吃掉首屏的是 `Gallery` 的 `h-[50vh]` 主图，不是 banner 的 22rem。
- 验证：**禁止浏览器与 CDP**（用户明确要求）→ 只有 SSR 探针（`renderToStaticMarkup`）+ 铸 cookie 抓页面两条路，见 skill。
- 操作条 = **图标 + 文字**（Heart/Star/Flag/Pencil，`size={15}`，`aria-hidden`）；无图标版已被否。`ACTION_TEXT`（`src/lib/ui/cls.ts`）：无边框无底色、`gap-1.5 py-1.5 text-sm`。`FollowButton` 是全站唯一保留描边/实底的动作。行容器 `justify-end`。
- **落位**（纠正过两次）：banner 模板在 `DownloadPanel` 之后、`DescriptionBlock` 之前，且在 `CollapsibleAside` **之外**；post 在右栏底部、article 居中栏、twocol 在左列内。
- **`CollapsibleAside` 收起必须「不重排」**：`overflow-hidden` + `<aside>` 两层，内层 `space-y-4 whitespace-nowrap lg:w-[340px]` 锁宽（光裁剪挡不住列宽压 0 → 折行 → 撑开整行）。340 用文件顶部常量 + **完整类名字符串**集中（Tailwind 只扫字面量）。`DetailTwocol` 的 360px `<aside>` 尚未同步加固。
- **VIDEO 只有一个视频**：`av-player` 里 `boxed = isAudio`；模板层对 VIDEO **整块不渲染 `<Gallery>`**（空数组会渲染「暂无预览图」）。落位：`DetailTwocol` 播放器进**主列**；`DetailBanner` 退化成深色标题带；`DetailArticle` 跳过封面 hero。
- **回退不要按目录**：`git checkout HEAD -- <dir>` 会带走该目录所有未提交改动；先 `git diff --stat`。

## 打包器文件追踪
- 追踪只静态分析 `path.join(process.cwd(), "<字面量>", 动态尾段)`；路径一经函数计算就退化成「追踪整个项目」，build 打 `Warning: Dynamic filesystem access`。规矩：**字面前缀留在真正调 `fs` 的地方**，越界靠「结果一定在 `public/<sub>/` 之下」结构排除（`safeRel` 拒 `..`/NUL/空、`\` 统一 `/`）。

## IP / 防刷
- IP 取法与哈希**唯一实现** = `src/lib/ip.ts`：`ipFromHeaders()`（`x-forwarded-for` 首段 || `x-real-ip`）、`hashIp()`（`sha256(ip + AUTH_SECRET)` 取 16 位 hex）、`subjectKeyFor()`（`u:<id>` / `ip:<hash>`）。新的按 IP 去重/配额必须复用；各写一份 → 算法漂移 → 跨表关联不上。**别再往 `track/route.ts` 里加内联第二份**（那里曾漏 `x-real-ip` 回退，导致无反代部署下全站共用一个限流桶）。
- `rateLimit(key, limit, periodMs)` 走 Postgres（表缺失自动回退内存 Map），非原子；key 带维度前缀。

## 贡献分 / 创作者激励（`points*.ts`）
- 阈值唯一落点 = `src/lib/points-config.ts`（后台 `/admin/incentive`）；业务模块**不许再写业务数值字面量**。加减 `PointReason` 枚举时 `DEFAULT_SCORES` 的 `satisfies Record<PointReason, number>` 会立刻报错 —— 刻意的编译期护栏，别改宽松。
- 唯一写入口 = `src/lib/points.ts` 的 `awardPoints()`（永不抛错、P2002 静默）。幂等键 = `@@unique([userId, reason, refId])`。
- **`refId` 必须把触发者编进去**（`interactionRefId("like", actorId, targetId)`）：只写目标 id 的话「全站对同一作品永远只加一次分」。
- 自产自销拦截集合 = `NO_SELF_BENEFIT`（点赞/收藏/下载/评论/关注），**不含** PUBLISH/FEATURED/ADMIN_ADJUST/DAILY_LOGIN；判定走 `isSelfBenefit()`。
- **PUBLISH 分有两个发放点，缺一不可**：① `moderation.ts` 的 `approveResourceAction`（actorId = 审核人）；② `actions/resource.ts` 的 `createResourceAction` 直发分支（`directPublish` = `trusted || ADMIN || MODERATOR`，actorId = 本人）。共用幂等键 `(userId, "PUBLISH", resourceId)`；**新增任何「把资源变成 PUBLISHED」的路径必须同步补**（该分支曾被漏，2026-09-24 修复）。`restoreResource` 与举报复核 `PENDING→PUBLISHED` **刻意不发**；**存量直发资源不追溯补分**（用户 2026-09-24 决定）。
- 下载防刷：主体去重 + 月配额**只停计分，绝不拦下载**（`download-record.ts`）。
- 后台配置页保存是**整份替换（WYSIWYG）**：表单必须提交完整文档，`safeIncentive()` 用 zod 兜住缺失字段。

## PIX / 结算 / 支付（`coin*` / `settle*` / `payment*`）
- **冻结名单唯一事实来源 = `cfg.risk.frozenUserIds`**（`points-config.ts`）；`UserPoint.frozen` 列**已删**。绕过冻结必须显式 `awardPoints({ bypassFrozen: true })`。
- **两个池别混**：激励池 P = `floor(本期收入 × ratePermille) + carryInFen`（**carryIn 原样并入，不再乘比例**）；现金池 C = Σ收入 − Σ成本 − Σ已打款 − Σ退款。偿付闸门只认 `getSolvency()` 一处（`coin.ts`），前台 `/fund`、结算确认、提现申请、后台水位**必须共用**。
- **记账纪律**：`LedgerEntry` **只记真钱进出**（结算分配不进台账）；`WITHDRAW_PAID` **不写 `CoinLedger`**（只做 frozen−N、lifetimeWithdrawn+）。台面数字必须能追回一条记录。
- **密钥永不出服务端**：对外走 `publicPaymentConfig()` 的**结构投影**（白名单）。后台表单无密钥保存时提交 `KEEP_SECRET` 哨兵，服务端在 zod 校验**之前**换回库内真值 —— 顺序不能颠倒。
- `permilleText(n)` 去掉无意义小数位（`6000 → "60%"`）；金额一律整数分，字符串解析走 `parseYuanToFen()`，禁止 `parseFloat*100`。

## 首页板块「加载更多」
- 追加方式 = `paged` + `loadMode: "button" | "infinite"`，后台 `/admin/site` 三选。**别把 `paged` 合并成单字段**（存量 JSON 只有 `paged`）。
- `useLoadMore`（`src/lib/hooks/use-load-more.ts`）page/done 用 ref、并发用 ref 闩；哨兵 effect 依赖要带 `more.length`。

## creators 板块排序（`sort` / `period`）
- `getTopCreators(limit, sort="followers", period="all")`：**默认值就是兼容红线** —— 存量配置只有 `count`，改默认会让不改后台的现网排序被动变化。
- 返回的 `metric` = **驱动本次排名的那个数**，四组合语义不同（`followers`+`week/month` 是**窗口内新增关注数**）。展示必须走同一个 `creatorMetaText(resources, metric, sort, period)`（`src/lib/format.ts`）；写死「粉丝」会把贡献分榜的分数说成粉丝数。
- 配置四处同步：`home-config.ts` / `site-config.ts` 的 `creatorsCfg`、`HomeSectionConfig` 联合、`DEFAULT_*`。后台**两个**编辑器（`home-admin/SectionEditor.tsx`、`site-admin/WidgetEditor.tsx`）都要加控件，漏一个 = 「能存但界面调不了」。

## TypeScript 配置联合的类型陷阱
- 往 `HomeSectionConfig` / `SidebarWidgetConfig` 这类**按 shape 区分的联合**加字段时，若字段名与别的成员重名（creators 的 `sort` vs list 的 `sort`），对象字面量会挑错成员并报看不懂的错：`Type '"followers"' is not assignable to type '"latest"|"popular"|"downloads"'`，或对着 `stats` 的 `Record<string, never>` 报 `Type 'number' is not assignable to type 'never'`。
- 对策：一次把 **schema / 联合类型 / 默认值 / 全部构造点** 补齐并精确匹配；必要时给该分支独有字段名或改 `kind` 判别式联合。**看到 `never` 的赋值错误，先怀疑 `Record<string, never>` 这个能把任何对象都当候选的成员。**

## 页面标题（metadata）与收录
- **根 layout 的 `title.template`（`%s · 站名`）作用于子段页面**（`/browse` 传 `浏览` → `浏览 · 资源社区`），子段页面写 `title` **不要自己再拼站名**。唯一例外 `app/page.tsx`（拿不到模板，必须自己拼）。
- **`/browse` 的 `page` 是死参数**：`FeedBrowser` 写死 `page = infinite ? 1 : intParam(...)`，而 `/browse` 开无限滚动 → `?page=3` 渲染的仍是第 1 页。所以 canonical **不能带 page**、title **不能带页码**。
- `/browse` 的 title + description + canonical 都随分类变；`cat` **只有命中 `getCategories()` 的真实 slug 才算数**，无效 slug 回落「无分类」并把 canonical 收敛到 `/browse`。
- **每个可收录列表页必须有 h1**：取 `cat ? cat.name : "浏览"`；搜索态（noindex）用 `<h1 className="sr-only">搜索</h1>` 补语义。`ArchiveShell` 只被 `/browse` 与 `/tags/[slug]` 用，h1 走它的 `heading` 槽位；`FeedBrowser` **首页也在用**，h1 **绝不能**加进 `FeedBrowser`。
- **description 要和 title 一起做**：根 layout 只给**一个**默认描述。`getCategories()` 是 `cache()` 的 → `generateMetadata` 与页面同请求只查一次库。
