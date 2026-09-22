# Pixel Hub —— 长期项目约定

> 只留「改错了会再踩一次」的规则；踩坑经过放 `.workbuddy/memory/YYYY-MM-DD.md`。

## CSS 布局
- 单列 grid 必须显式 `grid-cols-1`（= `minmax(0,1fr)`）。裸 `grid gap-1` 的隐式 auto 轨道按 min-content 起算，行内 `truncate` 会撑爆卡片；`min-w-0`/`truncate` 只加行内层压不住。
- `globals.css` 中 `@import "tailwindcss"` 之后的规则是**无层**的，优先于任何 `@layer`：与 `* { scrollbar-width:thin }` 冲突时 Tailwind 任意值（中括号）写法被静默压掉 → 用无层普通 class（`.scrollbar-none`）。注释里别原样写中括号类名。
- `overflow-x-auto` 会把 overflow-y 变 auto 并裁自身溢出：横向滚动 + 下划线 tab 的 `-mb-px` 挂在**滚动容器**上。

## 图片压缩
- 一律走 `src/lib/media/compress.ts` 的 `compressWith()`，禁止直接 `.webp()/.jpeg()/.png()`。
- alpha：webp 锁 `alphaQuality:100`；png `quality<100` 用 `palette:true`、`=100` 无损；jpg 先 `flatten({background:"#ffffff"})`（否则透明变黑）。
- 参数取自 `SiteSetting["uploadLimits"]`（后台 `/admin/uploads`）；缩略图质量 = 主图 − 8（下限 40）。落盘 key 扩展名必须与输出格式一致。

## 上传体积的存储与展示（单位化）
- **存储口径恒为整数 MB**（`attachmentMaxMb` 等），单位只活在输入层与展示层。
- 展示**唯一落点** = `src/lib/upload-config.ts` 的 `sizeText(mb)`；前台再套 `mbText()` 加「≤」。**禁止任何地方再写 `mb/1024` 裸折算** —— 曾把 1500MB 渲成 `1.46484375GB`（"有零有整"）。
- GB 只在 **`mb % 512 === 0`**（半 GB 对齐，`GB_ALIGN_MB`）时启用 → 1/1.5/2/2.5…GB 干净表达，1500/3000 这类除不尽的档位天然落回 MB。`fromMb()` 与 `sizeText()` 必须用**同一条规则**，否则输入框单位与概览卡会打架。
- 后台附件上限 = 数值输入 + 单位下拉（draft 拆 `attachmentSize` + `attachmentUnit`）；换单位走 `changeUnit()` 无损折算（MB→GB 用 `.toFixed(4)`，误差 ≤0.0512MB，round 回来是同一个 MB）；非法输入时保存按钮必须 `disabled`。图片四档（1–100MB）不给单位选择。

## 附件 / 音视频上传（改动前必读）
- 唯一上传按钮 = `src/components/upload/AttachmentUpload.tsx`；全站禁止再手写 `<label>`+`<input type=file>`。四态：可上传 / 拖拽悬停（`dragging`+`dropProps`）/ 上传中（`progress`）/ 已回执（`filled`）。
- `accept` 按 kind 分派：MUSIC/VIDEO **必须**传 `avAcceptAttr(kind)`（否则合法文件选不中）。
- 进度别混用：单文件字节进度用 `percent`；`progress({done,total})` 是**批量**语义。
- 清空 `input.value` 必须在 `onFiles` **之后**（Chrome 的 `input.files` 是同一份 FileList）。
- 清单编辑器 = `AttachmentListEditor`。`variant="dropzone"` 投放区，上传与抽屉**解耦**；`useFileDrop({disabled})` 只挂 `rows.length>=20`，**不挂 busy**；计数用 `doneRef`/`totalRef`。抽屉草稿模型（`open` 编辑 / `draft` 新增互斥），上传回调读 `drawerHeldRef`（async 闭包读 state 是旧值）。
- 提交闸门 `onBusyChange(inflight)` → 宿主禁用提交 + `<form onSubmit>` 里 `preventDefault()` 兜回车。**新增带附件清单的表单必须接。**
- `av-section.tsx`（MUSIC/VIDEO）是单文件直传（写 `avUrl`），不套草稿模型：`dropzone` + `useFileDrop({disabled: uploading})`（上传中不收拖入，别抄清单那套）；**必须接 `onBusyChange`**。
- **字段错误 key 是 `url` 不是 `avUrl`**；GAME/ARTICLE 是 `downloads`、IMAGE 是 `mediaIds`。读错 key 错误被静默吞、页面「点了没反应」。
- 回执不能等 `probeFile()`（最坏 12s）：先出回执，probe 结果异步补提示。
- 视频自动封面：上传成功后 `capturePoster()` 抽 **10% 处**那帧（首帧常纯黑）；`autoCoverId` ref —— 自动值可覆盖自动值，用户手选过就不抢。
- 大文件通道：`/attachment/session` 三态（云盘分片 / `{mode:"driver"}` 流式直传 / `409 NO_CLOUD` 回退旧单请求）。旧 `/attachment` 走 `formData()`（整请求体进内存，硬限 250MB），`Content-Length` 预检必须在 `formData()` **之前**。流式直传 `PUT /api/upload/attachment/stream`：`localDriver.putStream` 先写 `.uploads-tmp/`（不在 public 下、不放 `os.tmpdir()` —— 跨盘 rename EXDEV）再 rename。能力用 `streamCapable()` 判，s3/chevereto 无 `putStream` → 仍 250MB。客户端进度**只能用 XHR**。

## ImageViewer（`src/components/ui/ImageViewer.tsx`）
- 平移按「可平移空间」（`panBounds`/`canPan`）判，不用 `zoom > 1` 当代理；位移必须在 `applyZoom`/`rotateBy` 后重新夹取。
- react-hooks v7 immutability：`useCallback`/`useEffect` 内不许写 `useRef.current`（只有 `useLayoutEffect` 可以）。

## UI 文案（tip）
- **前台（用户可见页）与后台是两套标准**：「配置含义」只属于后台（admin `hint` / settings `sectionHint` / 页首说明框）。前台只留三类 —— **约束**（门槛、金额范围）、**后果**（线下打款、冻结、收入为 0 则池子为 0）、**状态**（已确认 / 已打款）。用户明确要求过：前台不要写大段配置项说明。
- 前台**禁止**出现：配置数值的复述（「安全水位 10% 可用」）、实现说明（「以提交时的比例为准」「兑换比例 100 PIX/元」——折算后的金额已经在旁边）、「可在后台配置」、内部术语（`偿付闸门` → 写「顺延到收入到账后再处理」）、设计理由（「同一个数字只在一处出现才对得上账」）、对外提「密钥」。
- 中文 UI 文案里**不要用反引号**——会原样渲染（曾被写进 `/creators` 的公示说明）。
- 只讲「怎么操作」且已由可见控件表达的文案＝多余。图标按钮的 `title` 是**无障碍名称**，必留。
- 同一句话不要在一个页面里出现两次（页首说明 + 区块 info 块重复是常见来源）；跨页重复可以接受。
- 无限滚动哨兵（`feed/FeedInfinite.tsx`）删文案后必须保留容器高度，否则 IntersectionObserver 目标塌陷。

## 破坏性操作 / 评论区楼层树
- **全站禁止原生 `confirm`/`alert`/`prompt`**：统一用 `src/components/ui/feedback.tsx` 的 `confirmDialog()` / `toast()`（全局惰性 host，零 Provider 侵入）。删除类操作 = 先 `confirmDialog({danger:true})` → 再调 action → 结果出 `toast`。**action 的失败原因要能直接 toast**（返回 `error?: string`，别只回 `ok:false`）。
- 确认后立刻进入「进行中」态（按钮 `disabled` + 文案换「删除中…」）再发请求；`finally` 里无论成败都 `router.refresh()` —— 网络异常时服务端可能已经改完了，刷新才能回到真实状态。
- **评论楼层树的根判定必须与 `rootIdOf` 同一口径**：根 = 无父 **或** 父已被删（上溯链断裂）。`getResourceDetail`（`src/lib/queries.ts`）曾用 `filter(c => !c.parentId)` 当根，而 `rootIdOf` 会把「父被删的回复」算成根 → 这类回复**既不是根、也不在任何根的 replies 里，整条被静默吞掉**（页面看不到，库里仍是 `PUBLIC`，侧栏「最新评论」却还显示）。改成 `rootIds = Set(过滤 rootIdOf(c) === c.id)`，replies 循环用 `if (rootIds.has(c.id)) continue` 排除自身（否则升格的那条会把自己列成自己的回复）。
- `Resource.commentCount` 对**每条评论（含回复）**都 `+1`，而删一条评论只 `-1`。所以「删根 → 回复升格」时计数天然对得上（剩下的回复仍算 1 条），不需要额外改动；反过来若改成「连回复一起删」，必须同步补扣。

## 详情页操作条（用户明确要过，别改回去）
- 形态 = **图标 + 文字**（Heart/Star/Flag/Pencil，`size={15}`，`aria-hidden`）；无图标版已被否。`ACTION_TEXT`（`src/lib/ui/cls.ts`）：无边框无底色、`gap-1.5 py-1.5 text-sm`。`FollowButton` 是全站唯一保留描边/实底的动作。
- `ActionBar` 行容器 `justify-end`；状态走文案 + 颜色双通道。
- **落位**（纠正过两次）：banner 模板的 `<ActionBar>` 在 `DownloadPanel` 之后、`DescriptionBlock` 之前，且在 `CollapsibleAside` **之外**；post 在右栏底部、article 居中栏、twocol 在左列内。
- **`CollapsibleAside` 收起必须「不重排」**：`overflow-hidden` + `<aside>` 两层，内层 `space-y-4 whitespace-nowrap lg:w-[340px]` 锁宽（光裁剪挡不住列宽压 0 → 折行 → 撑开整行）。340 用文件顶部常量 + **完整类名字符串**集中（Tailwind 只扫字面量）。`DetailTwocol` 的 360px `<aside>` 尚未同步加固。

## 详情页模板是高发改动区
- 四模板共用 `src/components/resource/detail/parts.tsx`；`detailTemplate.byType` 后台可配（信息面板标题不能写死）。
- **回退不要按目录**：`git checkout HEAD -- <dir>` 会带走该目录所有未提交改动；先 `git diff --stat`。
- **VIDEO 只有一个视频**：`av-player` 里 `boxed = isAudio`；模板层对 VIDEO **整块不渲染 `<Gallery>`**（空数组会渲染「暂无预览图」）。落位：`DetailTwocol` 播放器进**主列**；`DetailBanner` 退化成深色标题带；`DetailArticle` 跳过封面 hero。
- **音视频在 OneDrive 也要能播**：`/od` 按扩展名分流 —— 音视频走代理转发（自定 MIME + `Content-Disposition: inline` + `Accept-Ranges`，`Range`/`Content-Range` **必须透传**，206 原样返回），其余 302 预鉴权地址。
- 测「路径穿越」别用 HTTP 客户端（fetch/undici 与 Next 路由会**先折叠 `..`**）；要么裸 socket + 上游桩回显路径，要么别断言。

## 打包器文件追踪
- 追踪只静态分析 `path.join(process.cwd(), "<字面量>", 动态尾段)`；路径一经函数计算就退化成「追踪整个项目」，build 打 `Warning: Dynamic filesystem access`。规矩：**字面前缀留在真正调 `fs` 的地方**，越界靠「结果一定在 `public/<sub>/` 之下」结构排除（`safeRel` 拒 `..`/NUL/空、`\` 统一 `/`）。

## IP / 防刷
- IP 取法与哈希的**唯一实现** = `src/lib/ip.ts`：`ipFromHeaders()`（`x-forwarded-for` 首段 || `x-real-ip`）、`hashIp()`（`sha256(ip + AUTH_SECRET)` 取 16 位 hex）、`subjectKeyFor(userId, ipHash)`（`u:<id>` / `ip:<hash>`）。新的按 IP 去重/配额必须复用这一份；各写一份 → 算法漂移 → 同一 IP 在两表算出不同哈希，跨表关联不上。**别再往 `track/route.ts` 里加内联的第二份**（那里曾有一份，取 IP 时漏了 `x-real-ip` 回退，导致无反代部署下全站共用一个限流桶）。
- `rateLimit(key, limit, periodMs)` 走 Postgres（表缺失自动回退内存 Map），非原子；key 带维度前缀。

## 贡献分 / 创作者激励（`points*.ts`）
- 阈值唯一落点 = `src/lib/points-config.ts`（后台 `/admin/incentive` 可改）；业务模块**不许再写业务数值字面量**。加减 `PointReason` 枚举时 `DEFAULT_SCORES` 的 `satisfies Record<PointReason, number>` 会立刻报错 —— 这是刻意的编译期护栏，别改成宽松类型。
- 贡献分**唯一写入口** = `src/lib/points.ts` 的 `awardPoints()`（永不抛错、P2002 静默）。幂等键 = `@@unique([userId, reason, refId])`。
- **`refId` 必须把触发者编进去**（`interactionRefId("like", actorId, targetId)`）：只写目标 id 的话「全站对同一作品永远只加一次分」，第二个点赞的人不产生任何分，「收到点赞」直接废掉。
- 自产自销拦截集合 = `NO_SELF_BENEFIT`（点赞/收藏/下载/评论/关注），**不含** PUBLISH/FEATURED/ADMIN_ADJUST/DAILY_LOGIN（这些的 actor 本来就是本人或管理员）。判定走 `isSelfBenefit()`，别在别处重写一份。
- 下载防刷：主体去重 + 月配额**只停计分，绝不拦下载**（`download-record.ts`）。
- 后台配置页保存是**整份替换（WYSIWYG）**：表单必须提交完整文档，`safeIncentive()` 用 zod 兜住缺失字段。不要改成分字段增量写。


## 首页板块「加载更多」
- 追加方式 = `paged` + `loadMode: "button" | "infinite"`，后台 `/admin/site` 三选。**别把 `paged` 合并成单字段**（存量 JSON 只有 `paged`）。
- `useLoadMore`（`src/lib/hooks/use-load-more.ts`）page/done 用 ref、并发用 ref 闩；哨兵 effect 依赖要带 `more.length`。

## creators 板块排序（`sort` / `period`）
- `getTopCreators(limit, sort="followers", period="all")`：**默认值就是兼容红线** —— 存量配置只有 `count`，改默认会让不改后台的现网排序被动变化。
- 返回的 `metric` = **驱动本次排名的那个数**，四组合语义不同（`followers`+`week/month` 是**窗口内新增关注数**，不是累计粉丝数）。展示必须走同一个 `creatorMetaText(resources, metric, sort, period)`（`src/lib/format.ts`），标签随口径变；写死「粉丝」会把贡献分榜的分数说成粉丝数。
- 配置四处要同步：`home-config.ts` / `site-config.ts` 的 `creatorsCfg`、`HomeSectionConfig` 联合、`DEFAULT_*`。后台**两个**编辑器（`home-admin/SectionEditor.tsx`、`site-admin/WidgetEditor.tsx`）都要加控件，漏一个 = 「能存但界面调不了」。

## TypeScript 配置联合的类型陷阱
- 往 `HomeSectionConfig` / `SidebarWidgetConfig` 这类**按 shape 区分的联合**加字段时，若字段名与别的成员重名（如 creators 的 `sort` vs list 的 `sort`），对象字面量赋值会挑错成员并报出**看不懂的错**：`Type '"followers"' is not assignable to type '"latest"|"popular"|"downloads"'`，或对着 `stats` 的 `Record<string, never>` 报 `Type 'number' is not assignable to type 'never'`。这不是写错了，是联合匹配歧义。
- 对策：一次把 **schema / 联合类型 / 默认值 / 全部构造点** 补齐并精确匹配；必要时给该分支独有字段名或改用 `kind` 判别式联合。**看到 `never` 的赋值错误，先怀疑 `Record<string, never>` 这个能把任何对象都当候选的成员。**


## PIX / 结算 / 支付（`coin*` / `settle*` / `payment*`）
- **冻结名单唯一事实来源 = `cfg.risk.frozenUserIds`**（`points-config.ts`）。`UserPoint.frozen` 列**已删**，别再按"列 + 配置"两套口径理解冻结点。人工调整要绕过冻结必须显式 `awardPoints({ bypassFrozen: true })`。
- **两个池别混**：激励池 P = `floor(本期收入 × ratePermille) + carryInFen`（**carryIn 原样并入，不再乘比例**）；现金池 C = Σ收入 − Σ成本 − Σ已打款 − Σ退款（跨期结存）。偿付闸门只认 `getSolvency()` 一处实现（`coin.ts`），前台 `/fund`、结算确认、提现申请、后台水位**必须共用**，禁止任一处自己算一遍。
- **记账纪律**：`LedgerEntry` **只记真钱进出**（结算分配不进台账）；`WITHDRAW_PAID` **不写 `CoinLedger`**（只做 frozen−N、lifetimeWithdrawn+）。台面数字必须能追回一条记录，追不到的不许上页面。
- **密钥永不出服务端**：对外一律走 `publicPaymentConfig()` 的**结构投影**（白名单式，不是"记得手动删 key"）。后台表单在无密钥保存时提交 `KEEP_SECRET` 哨兵值，服务端在 zod 校验**之前**换回库内真值 —— 校验前置换顺序不能颠倒。
- `permilleText(n)` **去掉无意义小数位**（`6000 → "60%"`，不是 `"60.00%"`）；金额一律整数分，字符串解析走 `parseYuanToFen()`，禁止 `parseFloat*100`。

## 页面标题（metadata）与收录
- **根 layout 的 `title.template`（`%s · 站名`）确实作用于子段页面**：`/browse` 传 `浏览` → 渲染成 `浏览 · 资源社区`（实测）。所以给子段页面写 `title` **不要自己再拼站名**，否则重复。
- **唯一例外是同段的页面**：`app/page.tsx`（首页）拿不到模板，必须自己拼（该文件已有注释说明），所以首页写的是 `发现 · ${name}`。
- **`/browse` 的 `page` 是死参数**：`FeedBrowser` 里写死 `page = infinite ? 1 : intParam(sp,"page",1)`，而 `/browse` 开的是无限滚动 → `?page=3` 渲染的**就是第 1 页内容**，且没有任何链接指向它（`href()` 对 infinite 直接跳过 page）。所以 canonical **不能带 page**、title **不能带页码**（曾误加过「（第 N 页）」，是错的、已撤）。
- `/browse` 的 title + description + canonical 都随 **分类** 变：`${cat.name} · 浏览` 配分类专属描述；`cat` **只有命中 `getCategories()` 的真实 slug 才算数**，无效 slug 回落成「无分类」并把 canonical 收敛到 `/browse`（避免脏参数造出自称独立分类的软 404 页）。
- **每个可收录的列表页都必须有 h1**：`/browse` 曾是全站唯一没有 h1 的列表页（分类名只活在 title 与筛选 chip 里）。h1 取 `cat ? cat.name : "浏览"`，与 title 首段一致；搜索态（noindex）用 `<h1 className="sr-only">搜索</h1>` 补语义。
- **description 要和 title 一起做**：根 layout 只给**一个**默认描述，页面不自己写就全网相同 —— `/browse`、`/tags/[slug]` 都曾中招（已补）；`/creators`、`/fund`、`/resources/[slug]`、`/collections/[id]` 本来就自己写了。
- `getCategories()` 是 `cache()` 的 → `generateMetadata` 与页面（含 `FeedBrowser`）同请求只查一次库，两处都调不会多查。
- **h1 放哪儿**：`ArchiveShell` 只被 `/browse` 与 `/tags/[slug]` 用（首页不用），h1 走它的 `heading` 槽位；`FeedBrowser` **首页也在用**，所以 h1 绝不能加进 `FeedBrowser`（首页会多出一个 h1）。

## 本机验证环境
- **PowerShell 工具吞 stdout**；`Remove-Item` 对仓库内文件静默失败 → 用 `node -e "fs.unlinkSync/rmSync"`。
- **bash 的 `rm` 是坏 shim**，且缺 `head`/`ls`/`grep`/`tail`/`sleep`/`dirname`。查文件用 Read、搜内容用 Grep、批量文件操作用 node 一行脚本。
- 后台长任务用 `run_in_background`（`(cmd &)` 会随工具退出被杀）；轮询用 node 循环发 `curl --noproxy '*'`。
- 校验 runner 写 `%TEMP%`，用 `execFileSync(process.execPath, [...], {cwd, encoding:"utf8"})` 包 tsc/eslint 再打印。命令：`node node_modules/typescript/bin/tsc --noEmit`（零错误）、`node node_modules/eslint/bin/eslint.js src`。**存量 3 条 no-unused-vars warning**（`admin/media/page.tsx` 的 `enumParam`、`auth/PublishForm.tsx` 的 `draftCount`、`sidebar/SiteSidebar.tsx` 的 `authed`），别顺手改也别新增。
- 无浏览器验证（**没有** `pixel-hub-verify` 这个 skill，别去找）：走两条路 —— ① **纯函数/纯逻辑**抽成 `prisma/_*.ts` + tsx 跑断言（含全区间遍历）；② **页面渲染**铸管理员 JWT cookie 后 dev server fetch，断言 HTML 里的标签/`value`/`selected`/文案。三者都用反证断言（旧字符串必须消失、非法态必须出现红字）。
- 验 **metadata**（title / canonical / robots）同样不用浏览器：起 dev server → fetch 页面 → 解析 `<title>`、`<link rel="canonical">`、`<meta name="robots">`。**canonical 输出的是绝对 URL（被 metadataBase 拼过）且属性里 `&` 转义成 `&amp;`** —— 断言前必须 `new URL()` 归一成 path+search，否则全是假红灯。
- **`npm` 在这个 bash shim 里不通**（`npm run build` 退 127）。改用 node 直调：`node node_modules/prisma/build/index.js generate`、`node node_modules/next/dist/bin/next build`（约 2.5 分钟，用 `run_in_background`）。
- **构建不触库**：全站路由都是 `ƒ` 按需渲染，所以新增表没跑迁移也能 build 过；但**运行时**会 500。别拿「build 过了」当「迁移可以不做」的证据。
- **校验响应体首字节（BOM 等）不能用 `fetch().text()`** —— WHATWG 规范下 `text()` 会剥掉 U+FEFF，断言 `charCodeAt(0)===0xFEFF` 必然假红灯。必须 `Buffer.from(await r.arrayBuffer())` 查原始字节（UTF-8 BOM = `EF BB BF`）。
- **`next dev` 有目录级互斥锁**：同目录第二个实例会打印 `⨯ Another next dev server is already running`（含在跑实例的 PID/端口/日志路径）**并退出**。所以「探测某端口 ECONNRESET/超时」**不等于**没有实例 —— 先读 `.next/dev/logs/next-development.log` 或新实例日志再决定要不要重启。
- 放在 `%TEMP%` 的验证脚本 **require 基于脚本目录解析**，取不到仓库依赖；用 `createRequire("E:/project/pixel_hub/package.json")` 再 require。
- **DB 抖动时鉴权页是「静默重定向」**：`src/lib/auth.ts` 的 jwt 回调每次请求回查 DB 取 `role/trusted/passwordHash`；DB 不可达 → token 身份被清空 → `auth()` 得未登录态 → 受保护页 `redirect()`。SSR 表现 = **HTTP 200 + `<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/admin">`**（不是 307，也不是 500）。**别当权限 bug 追**；判据是同一 cookie 打 `/api/auth/session` 能不能拿到 `role`。
- **Supabase 会话池 `connection_limit=5`**：dev server 长驻占满时 `PrismaClient` 首连必报 `Can't reach database server`，而**裸 TCP 9ms 就通**。校验脚本一律包一层退避重试（~8 次 × 1.2s 递增）再跑；别据此改连接串。同一现象会让 **dev server 整页 500**（根 layout 的 `getSeoConfig`/`getRuntimeConfig` 一起挂，每页十几个并发查询，中一个就整页倒）。两条缓解：校验脚本抓到自己要的数据就 `await prisma.$disconnect()` 让路；必要时重启 dev server 换一个干净池。
- 铸管理员会话 cookie 做真机验证：`@auth/core/jwt` 的 `encode({ token: { id, username, role }, secret, salt: "authjs.session-token" })` —— `pw` 可省（服务端首次请求自行回查补上），**salt 必须是 cookie 名**。
- **`useAction`（→ `useRouter`）的客户端组件不能 `renderToStaticMarkup`**（`invariant expected app router to be mounted`）→ 涉及 `useAction` 的后台表单只能走「铸 cookie + dev server fetch」，别浪费一轮写静态渲染探针。
- 真机验证需临时改库时：读出**原始字符串** → 逐档改 → 抓页面断言 → **`finally` 无条件写回并复查与原值相等**（`getUploadLimits` 只有 `cache()` 请求内去重、无跨请求缓存，改完即时可见）。
- HTTP 层验证脚本**别写进仓库**（放 `%TEMP%`），跑完连 admin cookie 一起删（cookie 是有效凭据，别留在磁盘上）。
- 布局必须真机量测：`msedge.exe --headless=new --remote-debugging-port=<p> --user-data-dir=%TEMP%\x --no-proxy-server` + Node 内置 `WebSocket` 连 CDP，`Runtime.evaluate` 量 `getBoundingClientRect`。应用路由**不能**做探针（`src/app/_xxx` 不路由；根 layout 在 DB 不通时 500 且被 dev 遮罩替换）→ 改用 tsx `renderToStaticMarkup` + 内联 `.next/dev/static/chunks/*.css` + 本地 static server（**仅限不含 `useAction` 的纯展示组件**，见上条）。

## 临时脚本纪律
- 验证脚本一律 `_` 前缀放 `prisma/`，**用完立即删**；删未提交文件前先 `copyFileSync` 到 `%TEMP%`。
- **探针曾被误提交**（`c01bd55`）。提交前必须 `git status --short` 逐行确认、**只 add 本次任务的文件**，绝不用 `git add -A`。
- `.workbuddy/` 是项目数据**不是缓存**，受 git 跟踪；误删用 `git checkout -- .workbuddy/` 恢复。

## 编辑纪律（本仓真实踩到过）
- **同一个文件的多处改动不要放进同一批并行编辑调用**：会互相覆盖，且**失败的静默丢失**——工具仍回「Successfully edited」。本轮 `home.ts` 的 `metricById` 改写、`home-config.ts` 的联合类型、`site-config.ts` 的 meta 描述都被这样丢过，最后靠 tsc 报错才发现。规则：**一个文件一次只改一处**；批量改完后必须回头核对（grep 关键字 / 跑 tsc）。
- 批量并行编辑只用于**不同文件**。

