# Pixel Hub —— 细则（按需查阅）

> 从 `MEMORY.md` 拆出来的低频但必查的内容：上传链路与图片压缩、附件/音视频上传、云盘 Graph/OneDrive、Markdown 编辑器与 Crepe 样式、打包器追踪、**本机验证环境**。
> 改这些领域之前先读本文，别凭记忆写。

## 上传体积 / 图片压缩
- 压缩唯一入口 `src/lib/media/compress.ts` 的 `compressWith()`，禁止直接 `.webp()/.jpeg()/.png()`。alpha：webp 锁 `alphaQuality:100`；png `quality<100` 用 `palette:true`、`=100` 无损；jpg 先 `flatten({background:"#ffffff"})`（否则透明变黑）。参数取 `SiteSetting["uploadLimits"]`（后台 `/admin/uploads`）；缩略图质量 = 主图 − 8（下限 40）；落盘 key 扩展名必须与输出格式一致。
- **口径恒为整数 MB**，单位只活在输入层与展示层。展示唯一落点 `src/lib/upload-config.ts` 的 `sizeText(mb)`（前台套 `mbText()` 加「≤」）；**禁止任何 `mb/1024` 裸折算**（曾把 1500MB 渲成 `1.46484375GB`）。GB 只在 `mb % 512 === 0`（`GB_ALIGN_MB`）时启用，`fromMb()` 与 `sizeText()` 必须同一条规则。
- 后台附件上限 = 数值输入 + 单位下拉（draft 拆 `attachmentSize`/`attachmentUnit`）；换单位走 `changeUnit()` 无损折算（MB→GB 用 `.toFixed(4)`）；非法输入时保存按钮必须 `disabled`。图片四档（1–100MB）不给单位选择。

## 附件 / 音视频上传
- 唯一上传按钮 `src/components/upload/AttachmentUpload.tsx`；全站禁止再手写 `<label>`+`<input type=file>`。四态：可上传 / 拖拽悬停 / 上传中 / 已回执。
- **别自造 FileList**：它没有 `Symbol.iterator`。`Object.create(FileList.prototype)` 替身会让 `Array.from(fl)` 恒返回 `[undefined]`（曾致 `/upload` 粘贴多张只出一张）。自造必须显式挂 `Symbol.iterator`（见 `use-file-paste.ts` 的 `asFileList()`）；`useFileDrop` 透传宿主 `dataTransfer.files` 无此问题。
- `accept` 按 kind 分派：MUSIC/VIDEO **必须**传 `avAcceptAttr(kind)`。单文件字节进度用 `percent`，`progress({done,total})` 是**批量**语义。清空 `input.value` 必须在 `onFiles` **之后**。
- 清单编辑器 `AttachmentListEditor`：`variant="dropzone"` 投放区与抽屉**解耦**；`useFileDrop({disabled})` 只挂 `rows.length>=20`，**不挂 busy**；计数用 `doneRef`/`totalRef`；上传回调读 `drawerHeldRef`（async 闭包读 state 是旧值）。`av-section.tsx` 是单文件直传（写 `avUrl`），同样必须接 `onBusyChange`。
- 提交闸门 `onBusyChange(inflight)` → 宿主禁用提交 + `<form onSubmit>` 里 `preventDefault()`。**新增带附件清单的表单必须接。**
- **字段错误 key 是 `url` 不是 `avUrl`**；GAME/ARTICLE 是 `downloads`、IMAGE 是 `mediaIds`。读错 key 错误被静默吞、页面「点了没反应」。
- 回执不能等 `probeFile()`（最坏 12s）：先出回执，probe 异步补提示。视频自动封面 `capturePoster()` 抽 **10% 处**那帧；`autoCoverId` ref —— 自动值可覆盖自动值，用户手选过就不抢。
- 大文件通道 `/attachment/session` 三态（云盘分片 / `{mode:"driver"}` 流式直传 / `409 NO_CLOUD` 回退旧单请求）。旧 `/attachment` 走 `formData()`（整请求体进内存，硬限 250MB），`Content-Length` 预检必须在 `formData()` **之前**。`PUT /api/upload/attachment/stream`：先写 `.uploads-tmp/`（不在 public 下、不放 `os.tmpdir()` —— 跨盘 rename EXDEV）再 rename；能力用 `streamCapable()` 判。客户端进度**只能用 XHR**。

## 云盘（Graph / OneDrive，`src/lib/storage/onedrive.ts`）
- 凭据：后台运行配置 > `.env`（`GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET`），缺一即整功能关闭、附件回退原存储。app-only，**不能用 `/me/drive`，不支持个人 MSA**。
- locator 白名单 `drives|sites|users|groups/`。形态：`drives/{id}`、`sites/{siteId}/drive`、`sites/{host}:/sites/{team}:/drive`、`users/{UPN}/drive`。
- **507 = 配额爆了，不是连不通**。Graph 体 `{"error":{"code":"quotaLimitReached"}}`；先 `GET /v1.0/{locator}?$select=id,name,driveType,quota` 看 `quota.state`（`exceeded`）/`remaining`。用户盘 `total` 被下调（如 10 GiB）而 `used` 远超它（如 2.27 TiB）会长期 507；**同租户里站点盘还能写就说明租户池没耗尽，问题在每用户配额**（OneDrive 许可默认 1 TB、管理员最高覆写 5 TB，被重置回默认即此症状；站点转只读、数据不丢）。判定许可/池状态 **Graph 拿不到**（`/users`、`/subscribedSkus`、`/admin/sharepoint/settings` 全 403），要去 SharePoint 管理中心看。**后台 `/admin/drives` 的 active 盘指向这种盘 = 新附件全挂**，先切盘再排查。
- `graphErr()` 给 403/404/429/507 都补中文 hint；**新增状态码提示加在这里**，别在调用点各写一份。
- 引用语义 `/od/{driveId}/{itemPath}`，`itemPath = [rootPath/]YYYYMM/{安全原名}_{uuid}.{ext}`，**存储名必须保留原名**（Graph 下载响应的 `Content-Disposition` 用的是云盘存储名，否则用户下到随机 uuid 名）。`rootPath` 只影响新上传落点，存量引用自带完整路径。
- 音视频要能内联播：`/od` 按扩展名分流 —— 音视频走本站代理转发（自定 MIME + `Content-Disposition: inline` + `Accept-Ranges`，`Range`/`Content-Range` **必须透传**，206 原样返回），其余 302 预鉴权地址。
- 测「路径穿越」别用 HTTP 客户端：fetch/undici 与 Next 路由会**先折叠 `..`**，看到的 200 无法区分「被拒」和「已规范化」。

## ImageViewer（`src/components/ui/ImageViewer.tsx`）
- 平移按「可平移空间」（`panBounds`/`canPan`）判，不用 `zoom > 1` 当代理；位移必须在 `applyZoom`/`rotateBy` 后重新夹取。
- react-hooks v7 immutability：`useCallback`/`useEffect` 内不许写 `useRef.current`（只有 `useLayoutEffect` 可以）。

## Markdown 渲染与编辑器（`rte/Markdown.tsx` + `rte/MdEditor.tsx`）
- 渲染端唯一实现 = `src/components/rte/Markdown.tsx`（react-markdown），**默认不渲染原始 HTML** —— 安全默认，别为某个标签加 `rehype-raw`。全站 4 个调用点都走它。
- **裸写的 `<br>` 会被转义成文本**。修法：内联 `remarkBrAsBreak` 插件把 mdast 的 `html` 节点（值为 br 标签）换成 `break` 节点（搜 `BR_TAG`）。Milkdown 按 Shift+Enter 产出的是反斜杠硬换行，本来就能渲染，不要动；`<script>` 仍转义。
- 编辑器 = Milkdown Crepe；排版基准 = **前台 `.md-body--lg`**（15px），编辑时所见 = 发布后所得。
- **覆盖 Crepe 主题必须用 4 层选择器**（`.md-editor .milkdown .ProseMirror X`）压过它的 3 层，否则要赌 CSS 加载顺序。Crepe `reset.css` 是「大标题文档」风（h1/h2/h3 = 2.625/2.25/2em、字重 400、上边距 24~32px、段落 `padding:4px 0`），对齐时字号/字重/行高/边距要**一起压**。**h5/h6 前台无规则**，编辑器里必须显式重置成 `inherit`；首尾元素补 `> :first-child/:last-child` 零边距。
- 代码字体栈唯一来源 = `:root` 的 `--md-font-code`。已对齐 17 元素 × 25 属性；**未对齐**：表格（Crepe 表格是带拖拽手柄的交互 widget）、docs 编辑器（前台 13px vs 编辑器 15px）。
- **详情页描述正文 = `parts.tsx` 的 `DescriptionBlock`**（唯一实现：裸 `md-body md-body--lg`，无卡片/底色/边框/小标题），article/post/twocol/banner 四模板共用 —— 改描述排版只改这一处，别再让某个模板单独渲染一份。
- **编辑器里手敲 `[文本](/路径)` 不会变成链接**（会变成字面量文本）。两个原因叠加：① Crepe 只有 **图片** 输入规则（`insertImageInputRule`／`![alt](url)`），**没有 link 输入规则**（`preset-commonmark` 里无 `Mod-k`、link 只能经工具栏 `toggleLinkCommand` 或粘贴）；② 存下来的正文里它仍是 text 节点，序列化器（remark-stringify / `mdast-util-to-markdown`）会把文本里的 `[`→`\[`、`(`→`\(`，于是入库的是 `\[资金池]\(/fund)`，前台按字面量渲染（react-markdown 这边没问题：`[资金池](/fund)` 一定解析成站内 `<Link>`）。**要加链接就两条路**：选中文字 → 工具栏「链接」→ 输入 `/fund`（`sanitizeLinkHref` 对无 scheme 的相对路径原样放行）；或**粘贴**无 HTML 的纯文本 markdown（`plugin-clipboard` 的 `handlePaste` 在 `html.length===0` 时走 `parserCtx` 解析 → 真链接）。不要试图在渲染端「把转义还原成链接」——那会连内容里真想显示的字面方括号一起改掉。
- 列表序号与项目符号色 = `--md-marker`（`var(--brand-400)`，暗色不单独覆写，随 brand-400 翻转）。**编辑器列表标记不走 `::marker`**：Crepe 用 `.milkdown-list-item-block li .label-wrapper`（项目符号是 svg、有序列表是数字），默认取 `--crepe-color-outline` = brand-200（淡到几乎看不见）→ 已加 `.md-editor .milkdown .ProseMirror .label-wrapper{, svg}` 两条取同一 token（4 层压 Crepe 的 3 层：(0,4,0) > (0,3,1)）。

## 账务（贡献分 / PIX / 结算）
- 命名：**贡献分** = 荣誉层（只增不减，决定等级与结算权重）；**PIX** = 资产层（提现/打赏会减少）；**元** 只在提现页与后台出现。
- 唯一写入口 = `src/lib/points.ts` 的 `awardPoints()`（**永不抛错、P2002 静默**）；幂等键 = `@@unique([userId, reason, refId])`。**`refId` 必须把触发者编进去**（`interactionRefId("like", actorId, targetId)`），只写目标 id 会「全站对同一作品永远只加一次分」。
- 自产自销拦截集合 = `NO_SELF_BENEFIT`（点赞/收藏/下载/评论/关注），**不含** PUBLISH/FEATURED/ADMIN_ADJUST/DAILY_LOGIN；判定走 `isSelfBenefit()`。**只拦本人（`actorId === userId`），小号互刷拦不住**；可刷面只剩 `FAVORITE_RECEIVED(5)` 与 `DOWNLOAD_RECEIVED(3)`，要收紧只能关掉这两项的 `settleEligible`。
- **PUBLISH 分有两个发放点**：① `moderation.ts` 的 `approveResourceAction`（actorId = 审核人）；② `actions/resource.ts` 的 `createResourceAction` 直发分支（`directPublish` = `trusted || ADMIN || MODERATOR`，actorId = 本人）。共用幂等键 `(userId, "PUBLISH", resourceId)`。**该分支曾漏，2026-09-24 修复。**
- **冻结名单唯一事实来源 = `cfg.risk.frozenUserIds`**；`UserPoint.frozen` 列**已删**。绕过冻结必须显式 `awardPoints({ bypassFrozen: true })`。
- 下载防刷：主体去重 + 月配额**只停计分，绝不拦下载**（`download-record.ts`）。
- **两个池别混**：激励池 P = `floor(本期收入 × ratePermille) + carryInFen`（**carryIn 原样并入，不再乘比例** —— 写成 `floor((收入+carryIn)×比例)` 会吞掉 `carryIn×(1−比例)`）；现金池 C = Σ收入 − Σ成本 − Σ已打款 − Σ退款。偿付闸门只认 `coin.ts` 的 `getSolvency()` 一处，前台 `/fund`、结算确认、提现申请、后台水位**必须共用**。
- **结算分只看「当期新增」**（`periodScores()`：按 `PointLog.createdAt` 落自然月窗口 + `settleEligible[r]===true` 分组求和）；`minScore`（默认 50）拦的是**当月新增分**，每月清零。榜单/等级看累计分，两处口径别混。**跨期只结转钱、从不结转分**（`carryOutFen → carryInFen` 是纯金额；封顶砍掉的权重与没用完的分数一律作废）。
- 两道闸门不可省：`minScore` 是**资格**门（不够分连 Σscore 都不进）；`minPayoutFen`（默认 500 分 = 5 元 = 500 PIX）是**最小发放额**门（不够则整期不发、全额结转）→ 「结算拿 1 PIX」结构上不可能，1 PIX 只能来自打赏。
- 结算 = **月粒度 + 人工触发**（`period` 只有 `"month"`，`periodKey="YYYY-MM"`，本地时区自然月）。**结转只继承上一期**（`carryInOf` 读 `prevPeriodKey` 且要求 `status !== "DRAFT"`）→ **确认必须按月份先后**。状态机 `DRAFT → CONFIRMED → PAID`，已确认期一律**沿用落库快照、绝不重算**（改它等于事后篡改已公示数字）；未确认月份库里连 `IncentivePeriod` 行都没有。
- **自动结算**（`src/lib/settle-auto.ts` + `instrumentation.ts` + `POST /api/cron/settle`）默认全关（`settlement.autoEnabled=false`）：① 只自动到「入账」，打款永远人工；② **必须按月串行补齐**，任一环中断就 `break`；③ 操作人写 `AUTO_SETTLE_ACTOR="system"`。`confirmPeriod` 撞 `@unique` 抛 P2002 → 当「别人做完了」。容器要 `TZ=Asia/Shanghai` + `tzdata`。
- **封顶副作用**：单人 `capPermille=4000` 长期只有一两人达标 → 每期只发 40%、钱滞留现金池；溢出额**无条件**回流给剩余人 → 池子不够大时低分者也拿满（实测 50 分与 950 分各得 2000）。要改公平性得改 `distribute()` 的回流口径。
- **记账纪律**：`LedgerEntry` **只记真钱进出**（结算分配不进台账）；`WITHDRAW_PAID` **不写 `CoinLedger`**（只 frozen−N、lifetimeWithdrawn+）。金额一律整数分，解析走 `parseYuanToFen()`（录入的 `amountYuan` 是**元**），禁止 `parseFloat*100`；`permilleText(6000) → "60%"`。
- 默认 `coin.perYuan = 100` ⇒ `fenToCoin(amountFen,100) === amountFen`；**贡献分与 PIX 无固定兑换率**，只有单期一次性间接兑换（`PIX = floor(池子分 × 当月分 ÷ 全站当月分之和)`）。改 `perYuan` 会同时改入账 PIX 与偿付负债 → `fenToCoin` 与 `newLiabilityFen` 必须同源。
- **密钥永不出服务端**：对外走 `publicPaymentConfig()` 的**结构投影**（白名单）。后台表单无密钥保存时提交 `KEEP_SECRET` 哨兵，服务端在 zod 校验**之前**换回库内真值 —— 顺序不能颠倒。
- 后台配置页保存是**整份替换（WYSIWYG）**：表单必须提交完整文档，`safeIncentive()` 用 zod 兜住缺失字段。

## 页面标题（metadata）与收录
- **根 layout 的 `title.template`（`%s · 站名`）作用于子段页面**（`/browse` 传 `浏览` → `浏览 · 资源社区`），子段页面写 `title` **不要自己再拼站名**。唯一例外 `app/page.tsx`（拿不到模板，必须自己拼）。
- **`/browse` 的 `page` 是死参数**：`FeedBrowser` 写死 `page = infinite ? 1 : intParam(...)`，而 `/browse` 开无限滚动 → `?page=3` 渲染的仍是第 1 页。所以 canonical **不能带 page**、title **不能带页码**。
- `/browse` 的 title + description + canonical 都随分类变；`cat` **只有命中 `getCategories()` 的真实 slug 才算数**，无效 slug 回落「无分类」并把 canonical 收敛到 `/browse`。
- **每个可收录列表页必须有 h1**（搜索态用 `<h1 className="sr-only">搜索</h1>`）。`ArchiveShell` 只被 `/browse` 与 `/tags/[slug]` 用，h1 走它的 `heading` 槽位；`FeedBrowser` **首页也在用**，h1 **绝不能**加进去。
- description 要和 title 一起做（根 layout 只给**一个**默认描述）。`getCategories()` 是 `cache()` 的 → `generateMetadata` 与页面同请求只查一次库。

## 打包器文件追踪
- 追踪只静态分析 `path.join(process.cwd(), "<字面量>", 动态尾段)`；路径一经函数计算就退化成「追踪整个项目」，build 打 `Warning: Dynamic filesystem access`。规矩：**字面前缀留在真正调 `fs` 的地方**，越界靠「结果一定在 `public/<sub>/` 之下」结构排除（`safeRel` 拒 `..`/NUL/空、`\` 统一 `/`）。

## 本机验证环境
- **PowerShell 工具吞 stdout**；`Remove-Item` 对仓库内文件静默失败 → 用 `node -e "fs.unlinkSync/rmSync"`。**bash 的 `rm` 是坏 shim**，且缺 `head`/`ls`/`grep`/`tail`/`sleep`/`dirname`。查文件用 Read、搜内容用 Grep、批量文件操作用 node 一行脚本。
- **`npm` 在这个 shim 里不通**（退 127）→ 用 `node node_modules/<pkg>/...`：`prisma/build/index.js generate`、`next/dist/bin/next build`（约 2.5 分钟，`run_in_background`）、`typescript/bin/tsc --noEmit`、`eslint/bin/eslint.js src`。**存量 3 条 `no-unused-vars` warning**（`admin/media/page.tsx` 的 `enumParam`、`auth/PublishForm.tsx` 的 `draftCount`、`sidebar/SiteSidebar.tsx` 的 `authed`），别顺手改也别新增。
- **`next build` 会被沙箱 safe-delete 拦在 `.next` 上**（工作区内单次删除累计 >50 文件要人工确认）→ 先把 `.next` **改名移出仓库**（`fs.renameSync` 同盘瞬间）再 build，收尾删 bak。
- **dev server 在跑时 `.next` 被占用，重命名直接 EPERM，build 别往原目录做**（会砸掉用户正在用的缓存）。可行绕法：把项目复制到**仓库外**（`package.json`/`next.config.ts`/`tsconfig.json`/`postcss`/`eslint`/`next-env.d.ts`/`.env` + `src`/`prisma`/`public`），`fs.symlinkSync(..., 'junction')` 复用原仓库的 `node_modules`，跑 **`next build --webpack`** → 2026-09-24 实测 exit 0。**必须 `--webpack`**：默认 Turbopack 对指向项目外的 symlink 直接 panic（`Symlink [project]/node_modules is invalid, it points out of the filesystem root`）。收尾删副本（别忘 `.env` 副本；先 unlink junction 再删，以免误删真 node_modules）。
- **`next build` 预渲染阶段失败是既有问题**：`/admin/runtime`、`/_global-error`、`/banned` 报 `Invariant: Expected workStore to be initialized`。编译（含 CSS）与 TS 检查是过的。**构建不触库**：路由都是 `ƒ` 按需渲染，新增表没跑迁移也能 build 过，但运行时 500。
- **`next dev` 有目录级互斥锁**：第二实例打印 `⨯ Another next dev server is already running` 并退出 → 「探测端口 ECONNRESET/超时」**不等于**没有实例，先读 `.next/dev/logs/next-development.log`。
- **DB 抖动时鉴权页是「静默重定向」**：`auth.ts` 的 jwt 回调每次请求回查 DB，DB 不可达 → `auth()` 得未登录态 → 受保护页 `redirect()`。SSR 表现 = **HTTP 200 + `<meta id="__next-page-redirect" http-equiv="refresh" ...>`**（不是 307/500）。判据：同一 cookie 打 `/api/auth/session` 能否拿到 `role`。
- **Supabase 会话池 `connection_limit=5`**：dev server 长驻占满时 `PrismaClient` 首连必报 `Can't reach database server`，而**裸 TCP 9ms 就通** → 校验脚本包退避重试（~8 次 × 1.2s）；脚本抓完数据 `await prisma.$disconnect()` 让路。
- 铸管理员 cookie：`@auth/core/jwt` 的 `encode({ token:{id,username,role}, secret, salt:"authjs.session-token" })` —— salt **必须是 cookie 名**。涉及 `useAction` 的组件不能 `renderToStaticMarkup`，只能「铸 cookie + dev server fetch」。
- 布局/样式**禁止浏览器与 CDP**（用户明确要求，headless、「只量一下不算 e2e」也不行）→ 样式类改动只做静态契约：① postcss 编 `globals.css` 断言新 class 真产出选择器；② `renderToStaticMarkup` 断言组件吐出的 class 串；③ 视觉一致性最终由人眼确认，报告里如实写「未做浏览器实测」。量测细节见 `pixel-hub-verify` skill。
- **canonical 输出绝对 URL（被 metadataBase 拼过）且 `&` 转义成 `&amp;`** → 断言前 `new URL()` 归一成 path+search。**校验响应体首字节不能用 `fetch().text()`**（WHATWG 剥 U+FEFF）→ `Buffer.from(await r.arrayBuffer())`。放 `%TEMP%` 的脚本 require 基于脚本目录解析 → 用 `createRequire("E:/project/pixel_hub/package.json")`。

## 图片水印（几何、字体与验证姿势）

- **两种绘制模式**：`mode:"path"`（主路径，站点字体轮廓）与 `mode:"text"`（回退，SVG `<text>` + fontconfig）。
  `resolveWatermark()` 决定用哪种：站点字体覆盖得住就 path（永远可用，与环境无关）；有缺字才 text，环境不支持则整条放弃。
- **path 模式的几何**（Fusion Pixel：`unitsPerEm = 1200`，即 12px 网格 × 100 单位，CJK 1em / 拉丁 0.5em）：
  字号 `clamp(round(图宽 × 0.028), 14, 96)`；层高 `2.2 × 字号`；内边距 `右 0.85em / 下 0.7em`，基线 `层高 − 下边距`。
  **字宽不再估算**：`run.advanceWidth / unitsPerEm` 是精确 em 值，乘字号即像素宽。放不下就整体缩字（迭代两次收敛，`fontSize *= 图宽 / need`），不设字号下限。
  字形只在 `<g>` 上做一次 `scale(s, -s)` 把字体单位（y 向上）翻到 SVG 的 y 向下，各字形的平移量仍写原始字体单位 —— 不必逐点换算。
  `gravity:"southeast"` 让 sharp 自己算落点 → **不需要精确的底图尺寸**，宽高只用于字号缩放与「放不放得下」的判断。
- **字体身份**：`public/fonts/fusion-pixel-12px-proportional-zh_hans.woff2`（`familyName = Fusion Pixel 12px P zh_hans`，sha256 前 16 位 `56e986127ad11064`），
  与 `globals.css` 的 `@font-face` 同一文件。**换字体只需换这个文件**，两条链路一起变。
- **怎么验**（无需浏览器、无需真实存储）：
  1. 进程内探针：与 fontkit 独立算一遍期望包围盒比对（能抓出 y 翻转弄反、scale 算错、基线偏移）；
     填充规则用 `口` 验（中心必须透明，否则说明 nonzero 缠绕方向被处理错了）；
     确定性用「两次渲染逐字节一致」；窄图用「墨迹不越界」验「缩字而不是裁字」。
  2. **HTTP 端到端**（`storageDriver=local` 时安全：产物落 `public/uploads/`，已 gitignore）：
     铸 `authjs.session-token` cookie（`@auth/core/jwt` 的 `encode`，salt **必须等于 cookie 名**）→
     token payload 只给 `{ id, sub, username }` 就够：`src/lib/auth.ts` 的 jwt 回调是
     `if (!row || row.bannedAt || (t.pw !== undefined && t.pw !== sig))` —— **不带 `pw` 反而免检**（身份每次请求从 DB 回查刷新）；
     带了就必须等于 `passwordHash.slice(-16)`，不等会被清空身份 → 未登录态。
     → `POST /api/upload?max=1`（FormData 字段 `files`，`sameOrigin()` 对不带 Origin 的客户端放行）
     → 取回 `origUrl` 解码。
     **最强的一条断言**：把产物右下角裁成 `覆盖层宽×高` 与「本地 `buildOverlay` 贴到同色底」**逐字节比** —— 位置、字号、字形、颜色一次全对上，这才算证明「运行时真的用了站点字体」。
     反证：同一张图在关印状态下上传，整图必须**一个像素都没变**。
  3. 收尾删 Media 行 + 目录**下全部**产物（只登记原图会留下 `big.webp/thumb.webp` 让 `rmdir` 失败）。
  4. **改用户级开关做断言必须双边还原**：先存原值 → 断言 → 还原 → 再单独断言「已还原为原值」（`watermarkImages:false` / `watermarkText:null`）。写在 `finally` 里，否则中途失败就把线上账号的偏好改坏了。
- **fontkit 的坑**：ESM 产物（`dist/module.mjs`）**只有具名导出** `create/open/openSync/registerFormat/defaultLanguage/setDefaultLanguage/logErrors`，**没有 default**；
  CJS 产物把同样这些挂在 `module.exports` 上（Parcel `$parcel$exportWildcard`，**cjs-module-lexer 看不见**，所以 `import { create }` 也不保险）。
  结论：`import * as` + `default ?? 命名空间`，外加 `next.config.ts` 的 `serverExternalPackages: ["fontkit"]`（也顺便不把字体库打进 server bundle）。
  `fontkit` 不自带类型声明 → `src/types/fontkit.d.ts` 里手写最小声明。
- **加载姿势**：`fontkit.create(fs.readFileSync(...))` 都是同步的 → `siteFont()` 做成**懒加载同步单例**（失败结果也缓存），`buildOverlay`/`applyWatermark` 保持同步签名，`process.ts` / `social.ts` 一行都不用改。
  路径写成**字面量** `path.join(process.cwd(), "public/fonts/…woff2")`：产物追踪只对静态路径生效。运行镜像里 `public/` 由 `COPY --from=build /app/public ./public` 带过去。
- Dockerfile 运行的 `fontconfig + fonts-noto-cjk` 现在**只服务回退路径**（用户输入含 emoji 等缺字字符时）。`public/fonts/*.woff2` pango/librsvg 读不了，所以回退路径用的是系统字体，不是站点字体。

## 详情页落位（四模板）

- 四模板共用 `parts.tsx`；`detailTemplate.byType` 后台可配（信息面板标题不能写死）。**MUSIC / VIDEO 实际走 `post` 模板**
  （内置 byType 只给 GAME=banner、ARTICLE=article）—— banner 的音频紧凑首屏要后台配成 banner 才生效；post 下吃掉首屏的是 `Gallery` 的 `h-[50vh]` 主图。
- 操作条 = 图标 + 文字（Heart/Star/Flag/Pencil，`size={15}`，`aria-hidden`）；无图标版已被否。
  `ACTION_TEXT`（`src/lib/ui/cls.ts`）：无边框无底色、`gap-1.5 py-1.5 text-sm`；`FollowButton` 是全站唯一保留描边/实底的动作；行容器 `justify-end`。
- **落位（纠正过两次）**：banner 在 `DownloadPanel` 之后、`DescriptionBlock` 之前，且在 `CollapsibleAside` **之外**；
  post 在右栏底部、article 居中栏、twocol 在左列内。
- `CollapsibleAside` 收起必须「不重排」：`overflow-hidden` + `<aside>` 两层，内层 `space-y-4 whitespace-nowrap lg:w-[340px]` 锁宽
  （光裁剪挡不住列宽压 0 → 折行 → 撑开整行）。340 用文件顶部常量 + **完整类名字符串**集中（Tailwind 只扫字面量）。
  `DetailTwocol` 的 360px `<aside>` 尚未同步加固。
- VIDEO 只有一个视频：`av-player` 里 `boxed = isAudio`；模板层对 VIDEO **整块不渲染 `<Gallery>`**（空数组会渲染「暂无预览图」）。
  落位：`DetailTwocol` 播放器进**主列**；`DetailBanner` 退化成深色标题带；`DetailArticle` 跳过封面 hero。
- **播放卡的根 `<section>` 是 `mt-6 first:mt-0`，别改回裸 `mt-6`**（2026-09-25 用户报「视频播放多了个 mt-6 导致比别的下沉许多」）：
  MUSIC/VIDEO 走 `post`，`{!isVideo && <Gallery/>}` 对 video 不渲染任何节点 ⇒ 播放卡成为模板根容器**首个子元素**，
  原来无条件的 `mt-6` 就变成凭空多出的 24px（音频/图片首块是 `Gallery`，无上边距）。`first:mt-0` 只在「确有前驱块」时保留间距：
  post 视频 / twocol 视频归零，banner（横幅之后）、article（封面/正文之后）不受影响。
  Tailwind v4 产物 = `.first\:mt-0:first-child`，特异性 (0,2,0) > `.mt-6` 的 (0,1,0) ⇒ 不依赖 CSS 顺序。
- **页面宽度 = `max-w-7xl`**（2026-09-25 从 `max-w-6xl` 同步成全站宽度，与导航栏 / 个人主页 / browse 一致）。共 **7 处**，改宽度别只改一处：
  `resources/[slug]/page.tsx` 的 `previewCls` / `topSlot` / `bottomSlot` 三个 `mx-auto max-w-7xl px-4 …`，
  加四个模板各自的根容器（`DetailBanner:61` `pt-8 pb-6`、`DetailPost:103` `pb-16 pt-8`、`DetailTwocol:31` `py-8`、`DetailArticle:37` `pb-16 pt-8`）。
  **四模板内容顶部统一 `pt-8`**（2026-09-25 把 post 的 `pt-6` 提上来；MUSIC/VIDEO 实走 post，用户报的「music 的 pt 不一致」就是这个）——别再把它降回 `pt-6`。
- **侧栏不相对于主栏多探出**：外框容器是 `mx-auto max-w-7xl lg:pr-6`（`SidebarLayout.tsx`）。**只加右侧**：主栏 children 自带 `px-4 sm:px-6`，rail 容器在 lg 下 `px-0`，不加这 24px 时侧栏会贴容器右边缘、比主栏内容多探出 24px（主栏 6xl 时被留白遮住，升 7xl 后暴露）。别改成 `px-6`（左侧会与 children 叠加成双倍）。
  `resources/[slug]/edit/page.tsx`（编辑页表单）**仍是 6xl**，刻意窄；`error.tsx` / `not-found.tsx` 的 `mx-auto flex max-w-6xl flex-col` 也是刻意收窄的居中列，别动。
- **正文里的宽内容防溢出**：`.md-body table` 走 `display:block + overflow-x:auto`（见 `MEMORY.md` 的 CSS 节）；`pre` 本来就有 `overflow-x:auto`、`img` 有 `max-width:100%`。
- 回退**不要按目录**：`git checkout HEAD -- <dir>` 会带走该目录所有未提交改动；先 `git diff --stat`。

## 个人主页背景（`.profile-bg-pc` + 设置页表单）

- **只有一张图、一个上传槽**（`slot` 参数已废），字段 `User.profileBgPcKey`（迁移 `0009`）。**仅桌面端渲染**：
  元素带 `hidden sm:block`；窄屏没有侧边留白，遮罩带会直接压到卡片上（用户 2026-09-24 明确砍掉移动端那版，不要再加回来）。
- 遮罩只有一份 = `globals.css` 的 `.profile-bg-pc`（`to right` 横向渐变：贴屏幕边缘最清晰、向中间淡到 0，淡出终点 24% ≈ 视口 1920 时多探进内容区约 100px）。
  **设置页预览直接套这个类**（遮罩百分比相对元素自身 ⇒ 小预览与真实视口带子比例一致），不要在表单里复刻一份渐变。
- 层级：`aria-hidden` + `fixed inset-0 -z-10`，不参与布局、不盖 hero。外层是 `max-w-7xl` 容器，**只有 `fixed` 能铺到屏幕两端**。
- **门槛在激励配置**（`points-config.ts` 的 `incentive.profile.bgMinLevel`，等级序号，默认 2 = 资深创作者），尺寸上限在**上传限制**（`profileBgMaxMb`，后台 `/admin/uploads`）——两处刻意分开。
  唯一判定函数 = `upload-config.ts` 的 `profileBgUnlocked(level, minLevel, incentiveEnabled)`；**总开关关掉时门槛失效**（否则全员上锁且无提升途径）。
  前台渲染、设置页表单、server action 三处共用它；action 里**必须重算**（客户端只是不渲染入口）。
- **不做裁剪、不放大小图**：底图 cover 铺满，裁掉的恰好是遮罩留白区（裁剪器只会让用户困惑）；cover 交给 CSS，服务端只按后台格式重压。
- **推荐规格 = 16:10（≥ 1920×1200，长边 2560 更清晰）**，前台表单与后台 hint 都写这个数。两条几何依据：
  1. 遮罩**完全透明区间是 [24%, 76%]**（左右各 0–6% 全不透明、6–24% 渐隐、镜像）⇒ **中间 52% 的画幅在页面上根本看不见**，
     所以内容要放左右两侧各 1/4 内，中间留空或放低对比内容。
  2. `bg-cover` 只朝一个方向裁：图纸比例**比视口宽**时按高度贴满 → **左右被裁**（正好切在可见带上，最坏）；
     比视口窄/高时才按宽度贴满、只裁上下。16:10 在 16:10 屏零裁切、16:9 屏只裁上下 10%、21:9 屏裁上下 33%，
     左右全程完整；而常见的 16:9 图放到 16:10 屏上会裁掉两侧约 5% —— 那 5% 恰好是可见带。
- **资源详情页也铺作者这张背景**（`resources/[slug]/page.tsx`，2026-09-25 加）：
  - 判定写成 `if (作者有 key && 开关开) { 查一次点数 → profileBgUnlocked(...) }` —— 校验放在条件**内部**，
    没设背景的作者**零额外查询**（眼下是绝大多数）；已经用上开关的只有他一个人的一个布尔。
  - 复用同一个 `.profile-bg-pc` 类与同样的 `fixed inset-0 -z-10 hidden sm:block`；背景层放进 `SidebarLayout` 的
    children 首位即可（`fixed` 不参与 grid 流），**不需要额外包 fragment**。
  - 开关是**独立 action + 独立表单**（`updateProfileBgOnResourceAction`）：HTML 表单不能嵌套，它挂在上传 form
    **之外**，`useActionState` + `plFormRef.current?.requestSubmit()` 勾选即提交；改开关**不碰 `profileBgPcKey`**
    （关掉不删图，重新打开还在）。
  - 验证造条件的姿势：给目标作者临时塞一张真实 key + 把该用户的 `UserPoint.balance` 拉满 —— 比改全局
    `bgMinLevel` 更局部（一次只动一个用户的两个字段），还原时逐字段比对。
- **验证姿势**：线上全站 0 分 / 0 档 ⇒ 没人解锁，渲染分支必须临时把 `bgMinLevel` 置 0 + 给一个账号塞图才能验；
  先存原值 → 断言 → `finally` 里还原（配置还原要连 `version` 一起还原并断言逐字节一致）。

## slug 与 URL 编码（新写入恒为纯 ASCII，存量中文 slug 仍要可达）

- **落库 slug 的唯一生成入口 = `src/lib/slug.ts`**：`asciiSlug()`（同步，汉字整段转无声调拼音）与 `autoSlugBase()`（异步，**翻译 → 拼音 → 空串** 三级兜底）。
  `slugify()` 保留汉字，只是 `asciiSlug` 内部的归一函数，**新代码不要直接拿它写库**。8 个写入点已全部改完
  （`resource.ts` 资源 slug + 标签 slugName、`taxonomy.ts` ×5、`_resource-edit.ts` ×1）。
- 为什么必须 ASCII：① URL 变成 `/resources/pixel-hub%E6%9B%B4%E6%96%B0%E6%97%A5%E5%BF%97` 这种看不懂的编码态；
  ② **Node 的响应头只接受 Latin-1**（`\t` `\x20-\x7E` `\x80-\xFF`），汉字 > U+00FF ⇒ Next 把 redirect 目标**原样**写头
  （server action = `x-action-redirect`，页面级 = `location`）时抛 `ERR_INVALID_CHAR`，**资源已落库却整条响应失败**。
  跳转到动态段一律 `encodeURIComponent`（已修 `actions/resource.ts`、`resources/[slug]/edit/page.tsx`）。
- `_resource-edit.ts` 的标签创建**刻意不发翻译请求**（整个函数跑在调用方事务里）：只用同步 `asciiSlug`，改稿建出的标签是拼音 slug；
  发布侧 `findUnique({ where: { name } })` 兜底会复用，不会产生同名词条。
- **存量中文 slug 必须继续可访问**（线上 124 个标签里 70 个是中文、多为繁体，源于历史「翻译失败回退原文」）：
  **Next 16 的页面 `params` 不解码**（route handler 才解码），`params.slug` 到手仍是 `%E8%B6%85...`，直接查库 ⇒ 整页 404。
  唯一入口 = `decodeSlug()`，已接 `/resources/[slug]`（page + `generateMetadata`）、`/resources/[slug]/edit`、`/tags/[slug]`（page + `generateMetadata`）。
  **新增任何用 slug 查库的页面都要过这一道**。只解一次，双重编码 URL 就该 404，别改成循环解。
- `sitemap.ts` 拼 `<loc>` 必须 `encodeURIComponent`（裸汉字进 `<loc>` 是非法 URL）；`indexnow` / JSON-LD / canonical 走 `new URL()` / `absUrl()`，会自行编码。
  query 参数（`?cat=`）Next 正常解码；`generateMetadata` 与 page 是两次独立取参，**两处都要解**。
- 存量 70 个中文标签 slug **刻意不迁移**（迁移会改 URL）；是否迁由用户定。

## 邮件与外链 origin（`src/lib/request-origin.ts`）

- 唯一入口 = `requestSiteUrl()`：邮件链接（找回密码 `password-reset.ts`、通知 `mail-notify.ts`）与 `api/pay/create` 的回调地址。
  全部判定收在纯函数 `originFromHeaders()` 里（`next/headers` 那层只负责取头 + 非请求上下文回退 `siteUrl()`），便于探针断言。
- **端口策略：经代理的公网地址一律不带端口。** 反代/容器会把**上游内部端口**塞进转发头（宝塔 nginx、Caddy、Cloudflare Tunnel 都可能写
  `X-Forwarded-Host: site.com:3000`、`X-Forwarded-Port: 3000`），而邮件是发给**远端收件人**的 ——
  浏览器打开 `https://site.com:3000/...` 必然 `ERR_CONNECTION_REFUSED`。这就是「邮件模板里链接带端口」的根因。
  公网域名下端口只可能是 80/443，协议由 `x-forwarded-proto` 表达 ⇒ 剥离。
- **判据 = 「有没有反代痕迹」**：任一转接头出现（`x-forwarded-host` / `x-forwarded-proto` / `proto` / `x-forwarded-port` / `x-forwarded-for` / `x-real-ip`）
  即视为经代理 ⇒ 端口不可信，一律丢。两个例外保留端口：
  ① **回环主机**（`localhost` / `127.*` / `0.0.0.0` / `[::1]`）—— 本地 `next dev` 跑在 :3000，剥掉后预览链接点不开，同机反代还会把端口挪进 `x-forwarded-port`；
  ② **零转发头的直连** —— 此时 `host` 头就是用户地址栏里的地址，端口是他自己敲的。
  私网地址（`10.` / `192.168.` / `172.16-31.`）**不带端口**：收件人在公网，LAN 端口同样不可达。
- 历史坑：先「剥掉 host 的端口、再按 `x-forwarded-port` 补回」的写法会把同一个内部端口装回去（`e0437ef` 引入，2026-09-25 修）。**别退回那个判据。**
- 多值头（CDN 追加自身）取逗号分隔的第一项；协议顺序 `x-forwarded-proto` → `proto` → `http`；无 host 头回退 env 基址。
  无中括号的 IPv6 字面量（`::1`）会被端口正则啃掉尾巴 ⇒ `hostname.endsWith(":")` 时也回退。
- `mail-template.ts` 的页眉域名取 `new URL(linkUrl).hostname`（本身不含端口），无需再处理。

## CSS / 布局细则（`MEMORY.md` 只留红线，长解释在这）

- **单列 grid 必须显式 `grid-cols-1`**（= `minmax(0,1fr)`）：裸 `grid gap-1` 的隐式 auto 轨道按 min-content 起算，行内 `truncate`（`white-space:nowrap`）会把卡片撑爆。
- **无层规则优先于任何 `@layer`**：`@import "tailwindcss"` 之后写的规则没有 layer，优先级高于 `@layer`；与 `* { scrollbar-width:thin }` 这类全局规则冲突时，
  Tailwind 的任意值（中括号）写法会被**静默压掉** ⇒ 这种场景改用无层普通 class（`.scrollbar-none`）。注释里也别原样写中括号类名。
- **`overflow-x-auto` 会把 overflow-y 一起变成 auto 并裁自身溢出**：横向滚动 + 下划线 tab 的 `-mb-px` 必须挂在**滚动容器**上，挂内层会被裁掉。
- **`first:` 变体特异性高于裸 `mt-6`** ⇒ `mt-6 first:mt-0` 的归零不依赖产物顺序。
- 改 class 后**必须核 Tailwind 真产出了该类**：用 postcss 编 `globals.css` 再 grep 选择器（`node node_modules/postcss-cli/...`）。覆盖第三方主题（Crepe）一律 4 层选择器压它的 3 层（(0,4,0) > (0,3,1)）。
- `.md-body table` 是 `display:block` + `overflow-x:auto`（GitHub markdown-body 同款）：`display:block` 下浏览器仍补匿名 table box，单元格布局与 `border-collapse` 照常生效。**别改回纯 table** —— 那正是详情页整页横向滚动条的来源。
- `SidebarLayout` 外层容器见「详情页落位」节。

## UI 文案（前台 / 后台两套标准）

- 「配置含义」只属后台：admin 的 `hint` / `sectionHint` / 页首说明框。
- 前台只留三类：**约束**（门槛、金额范围）、**后果**（线下打款、冻结、收入为 0 则池子为 0）、**状态**（已确认 / 已打款）。
- 前台**禁止**：配置数值复述（「安全水位 10% 可用」）、实现说明（「以提交时的比例为准」）、「可在后台配置」、内部术语
  （`偿付闸门` → 「顺延到收入到账后再处理」）、设计理由、对外提「密钥」。
- 中文 UI 文案**不要写反引号**（会原样渲染，曾写进 `/creators`）；图标按钮的 `title` 是**无障碍名称**，删不得。
- 同一句话别在一个页面出现两次（页首说明 + 区块 info 块是常见来源）；跨页重复可接受。
- 无限滚动哨兵（`feed/FeedInfinite.tsx`）删文案后**必须保留容器高度**，否则哨兵直接消失、加载更多失效。

## 破坏性操作 / 确认弹窗 / 评论楼层树

- **全站禁止原生 `confirm` / `alert` / `prompt`**：统一用 `src/components/ui/feedback.tsx` 的 `confirmDialog()` / `toast()`（全局惰性 host，零 Provider 侵入）。
- 删除类标准动作：`confirmDialog({ danger: true })` → 用户确认 → 调 action → 按返回结果 `toast`。
  **action 的失败原因要能直接 toast**（返回值带 `error?: string`，别只回 `ok: false`）；确认后立刻进「进行中」态（`disabled` + 「删除中…」）再发请求；`finally` 里无论成败都 `router.refresh()`。
- **评论楼层树的根判定必须与 `rootIdOf` 同口径**：根 = 无父 **或** 父已被删。用 `filter(c => !c.parentId)` 会让「父被删的回复」既不是根、也不在任何根的 replies 里 ⇒ 整条被静默吞掉。
  正确写法：`rootIds = Set(rootIdOf(c) === c.id)`，replies 循环 `if (rootIds.has(c.id)) continue`。
- `Resource.commentCount` 对**每条评论（含回复）**都 `+1`，删一条只 `-1`；改成「连回复一起删」必须同步补扣。

## 验证纪律（`MEMORY.md` 验证节的补充）

- 存量 3 条 `no-unused-vars` warning：`admin/media/page.tsx:enumParam`、`auth/PublishForm.tsx:draftCount`、`sidebar/SiteSidebar.tsx:authed` —— 别改也别新增。
- **本机 shell 残缺**：`npm` / `npm run` 退 127；缺 `ls/grep/head/tail/sleep/dirname`；`rm` 是坏 shim。
  → 查文件用 Read、搜内容用 Grep、批量文件操作用 node 一行脚本；npm/npx 走 `node node_modules/<pkg>/…`（如 `node node_modules/tsx/dist/cli.mjs`、`node node_modules/typescript/bin/tsc`）。
- **断言类**：metadata canonical 是**绝对 URL** 且 `&` 转义成 `&amp;` ⇒ 先 `new URL()` 归一再比；查 BOM 不能用 `fetch().text()`（会剥 U+FEFF）⇒ `Buffer.from(await r.arrayBuffer())`。
  **新写/改写的回归断言必须反证一次**（把实现改回旧写法，断言如期变红），否则全绿是假信号。
- 探针 `_` 前缀放 `prisma/`、**用完立即删**（删前 `copyFileSync` 到 `%TEMP%`）；HTTP 层脚本不进仓库，跑完连铸出来的 admin cookie 一起删。
  **本环境会自动提交工作区改动**（英文 commit message、作者是用户）⇒ 交付前 `git ls-files "prisma/_*"` + `git status --short` 逐行确认，绝不用 `git add -A`。
- **含反引号的长文本别塞进 `node -e "…"`**：双引号里的反引号会被 command substitution **真正执行**（曾凭空造出 `1`、`=20` 垃圾文件；也把 schema 行改坏过）⇒ 追加记忆/日志/文档一律用 Write / Edit 工具。
