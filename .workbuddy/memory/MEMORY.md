# Pixel Hub —— 长期项目约定

> 只留「改错了会再踩一次」的规则。踩坑经过放 `.workbuddy/memory/YYYY-MM-DD.md`。

## 图片压缩
- 服务端压缩一律走 `src/lib/media/compress.ts` 的 `compressWith()`，业务代码禁止直接 `.webp()/.jpeg()/.png()`。
- alpha：webp 锁 `alphaQuality:100`；png `quality<100` 走 `palette:true` 量化、`=100` 无损；jpg 无 alpha，必须先 `flatten({background:"#ffffff"})` 再编码（否则透明变黑）。
- 参数来自 `SiteSetting["uploadLimits"]` 的 `imageFormat`/`imageQuality`（后台 `/admin/uploads`）。
- 缩略图质量 = 主图质量 − 8（下限 40）。落盘 key 的扩展名必须与输出格式一致（驱动靠扩展名定 content-type）。
- 回归：`npx tsx _test/compress-alpha.ts`。

## 附件 / 音视频上传（改动前必读）
- **唯一上传按钮** = `src/components/upload/AttachmentUpload.tsx`（导出 `AttachLimits`）。全站禁止再手写 `<label>` + `<input type=file>`。
  - 四态：可上传 / 拖拽悬停（`dragging`+`dropProps`）/ 上传中（`progress`）/ 已回执（`filled`）。
  - `accept` 按 kind 分派：MUSIC/VIDEO **必须**显式传 `avAcceptAttr(kind)`（服务端对 music|video 按 `avExtsFor` 放行，m4a/aac/opus/m4v/mov/ogv 都不在附件表里；不一致 = 合法文件选不中）。
  - 进度别混用：单文件字节进度走 `percent`（0..100）；`progress({done,total})` 是**批量**语义（渲染成「第 n / 共 m」）。
  - 内部清空 `input.value` 必须在 `onFiles` 之后（Chrome 的 `input.files` 是同一份 FileList，先清空消费者拿到空列表＝点选「没反应」），调用方不要再清。
  - `wizard-sections.tsx` 里同名的 `AttachmentUpload` 是薄包装（兼容 GameSection 多选进度），不要再往里加样式。
- **清单编辑器** = `AttachmentListEditor`（IMAGE 图包 / ARTICLE 文末 / GAME 下载源）。新增同类清单一律走它。
  - 主入口是 `variant="dropzone"` 的拖拽/点击投放区，不是按钮。
  - 上传与抽屉**解耦**：`onFiles` 拖入即传，不等抽屉；抽屉关掉不中断在飞任务。
  - `useFileDrop({disabled})` 只挂 `rows.length>=20`，**不挂 busy**；计数用 `doneRef`/`totalRef` 累计，别每批重置。
  - 提交闸门：`onBusyChange(inflight)` 交给宿主禁用提交 + `<form onSubmit>` 里 `preventDefault()` 兜回车。**新增带附件清单的表单必须接。**
  - 抽屉用草稿模型（`open` 编辑既有行 / `draft` 新增，互斥）；上传回调里判断抽屉占用要读 `drawerHeldRef`（async 闭包读 state 是旧值）。
- `av-section.tsx`（MUSIC/VIDEO）是**单文件直传**（直接写 `avUrl`），不套清单的草稿模型，但对外契约要对齐：
  - 用 `variant="dropzone"` + `useFileDrop({disabled: uploading})`（单文件字段，上传中不收新拖入；清单那边故意相反，别抄错）。
  - **必须接 `onBusyChange`**（`uploading ? 1 : 0`），漏接 = 大文件还在传就能点发布。
  - **字段错误 key 是 `url` 不是 `avUrl`**（服务端 `avMetaSchema` 的 issue path）；GAME/ARTICLE 是 `downloads`、IMAGE 是 `mediaIds`。读错 key 错误被静默吞掉、页面「点了没反应」。
  - 「已上传」回执不能等元数据抓取（`probeFile()` 读大视频最坏 12s 超时，按钮会像卡死）：先出回执，probe 结果异步补进提示。
  - **视频自动封面**：`av-section` 加 `onCoverFrame?(File)`，只在 `!isAudio && 宿主接了回调` 时、**上传成功之后**调 `capturePoster()`（`av-probe`：`<video>`+canvas 抽 **10% 处**那帧，不是第 0 帧——首帧常是纯黑/台标）。宿主负责走 `uploadImageFiles` 上传并落封面槽。
  - 自动值语义：宿主维护 `autoCoverId` ref —— **自动值可覆盖自动值，用户手选过封面就不抢**（与 av-section 里 duration/artist 的 `autoRef` 同规则）。
- **大文件通道**（无云盘时）：`/attachment/session` 回答三种——云盘分片 / `{mode:"driver"}` 本站流式直传 / `409 NO_CLOUD` 回退旧单请求通道。
  - 旧 `/attachment` 走 `req.formData()`，整个请求体进内存，硬限 250MB，且 `Content-Length` 预检必须在 `formData()` **之前**。
  - 流式直传：`PUT /api/upload/attachment/stream?name=&kind=`，体就是字节；`localDriver.putStream` 先写 `.uploads-tmp/`（**故意不在 public 下**，也**不放 `os.tmpdir()`** —— 跨盘 rename 会 EXDEV）再 rename。
  - 驱动能力用 `streamCapable()` 判（看有没有 `putStream`），别写死驱动名。s3/chevereto 无 `putStream` → 仍 250MB。
  - 客户端进度**只能用 XHR**（`fetch` 读不到上传进度）。限流只挂在真建 Graph 会话/真收字节那一步，探测不扣配额。

## CSS 层叠层与「无层优先」（踩过的坑）
- `globals.css` 里写在 `@import "tailwindcss"` **之后**的规则是**无层**的；Tailwind 工具类在 `@layer utilities`。**无层优先于任何分层**，该判断在特异性之前生效。
- 与全局无层规则冲突时（典型 `* { scrollbar-width: thin }`），Tailwind 的任意值写法（中括号）会被静默压掉。解法：在 `globals.css` 补一个无层普通 class（现有 `.scrollbar-none`）。
- `globals.css` 的注释里也别原样写出中括号类名（Tailwind 会扫注释当候选类，凭空生成规则）。
- 横向滚动 + 下划线 tab：`overflow-x-auto` 会把 overflow-y 算成 auto 并裁掉自身溢出，`-mb-px` 必须挂滚动容器，挂按钮上会被裁掉 1px。

## ImageViewer（src/components/ui/ImageViewer.tsx）
- 平移能力按「可平移空间」（`panBounds`/`canPan`）判，不用 `zoom > 1` 当代理条件：缩小时同样可拖动。
- 位移必须在 `applyZoom`/`rotateBy` 后重新夹取，否则放大拖动再缩回会停在偏移位置。
- react-hooks v7 的 immutability 规则不允许在 `useCallback`/`useEffect` 里写 `useRef.current`（只有 `useLayoutEffect` 内可以）。

## UI 文案（tip）取舍
- 只讲「怎么操作」且该操作已由可见控件表达的文案＝多余 tip，不写。必写四类：配置含义、约束（尺寸/格式/上限）、状态反馈（加载/空/错误/权限）、行为后果。
- 图标按钮的 `title` 是**无障碍名称**，属必留项，别当 tip 删（违反 a11y 红线）。
- 沿用写法：admin 表单 `hint`、settings 页 `sectionHint`（`mb-4 mt-1 text-xs text-neutral-400`）、admin 页首说明框（`rounded-none border border-brand-200 bg-surface px-4 py-3 text-xs leading-5 text-neutral-500`）。
- 无限滚动哨兵（`feed/FeedInfinite.tsx`）删文案后必须保留容器高度（现 `mt-6 flex h-8 items-center justify-center`），否则 IntersectionObserver 目标塌陷。

## 详情页操作条（用户明确要过，别改回去）
- 形态 = **「图标 + 文字」**：Heart / Star / Flag / Pencil，`size={15}`，一律 `aria-hidden`。无图标版本已被否掉（`74f4c4f`），别退回。
- `ACTION_TEXT`（`src/lib/ui/cls.ts`）：无边框无底色、`gap-1.5 py-1.5 text-sm`（32px 高）。`FollowButton` 是全站唯一保留描边/实底的动作，不要一起文字化。
- `ActionBar` 行容器 `justify-end`（收在右边）；下面「作者已关闭评论。」跟着 `text-right`。状态走文案+颜色双通道。
- **落位**（用户纠正过两次）：banner 模板的 `<ActionBar>` 在 **`DownloadPanel` 之后、`DescriptionBlock` 之前**，且必须在两栏网格 `CollapsibleAside` **之外**（塞进左列时 `justify-end` 只顶到 340px 侧栏左边缘）。post 在右栏底部、article 居中栏、twocol 在左列内。
- **`CollapsibleAside` 收起必须「不重排」**：`overflow-hidden` + `<aside>` 两层，内层再套 `space-y-4 whitespace-nowrap lg:w-[340px]` 锁死内容宽度。光裁剪挡不住高度重排（列宽压到 0 → 文本逐字折行 → 撑开整个 grid 行）。`whitespace-nowrap` 另挡长值抖动，代价是超长文本被硬切（侧栏是概览，刻意取舍）。
- 340 出现在 `RAIL_OPEN`/`RAIL_SHUT`/`RAIL_BOX`/把手 `style.right` 四处，用文件顶部常量 + **完整类名字符串**集中（不能 JS 拼类名，Tailwind 只扫字面量）。`DetailTwocol` 的 360px `<aside>` 尚未同步加固。

## 详情页模板是高发改动区
- 四种模板共用 `src/components/resource/detail/parts.tsx`，改一处全站生效；`detailTemplate.byType` 后台可配，任何改动都要考虑「换类型套同一模板」（典型：信息面板标题不能写死「游戏信息」）。
- **回退不要按目录**：`git checkout HEAD -- src/components/resource/detail/` 会一次带走该目录下所有未提交改动。先 `git diff --stat` 看清范围，现场备份到 `%TEMP%`。
- **VIDEO 只有一个视频**（用户明确要过）：`av-player` 里 `boxed = isAudio`——视频**不套卡片**（无边框无内边距，`block aspect-video w-full bg-black`），封面改挂 `<video poster>`；模板层对 VIDEO **整块不渲染 `<Gallery>`**。
  - ⚠️ 跳过必须「不渲染」，**不能传空数组**：`Gallery` 收到 `[]` 会渲染「暂无预览图」占位框，又变成一块多余的空块。
  - 落位：`DetailTwocol` 的视频播放器要进**主列**（不进则左列被抽空、视频孤零零落在两栏之外）；`DetailBanner` 的视频退化成一截深色标题带（横幅不再重复同一张封面）；`DetailArticle` 跳过带边框的封面 hero。
  - 默认 VIDEO 走 `post` 模板（`theme.detailTemplate`：default=post，byType 只覆盖 IMAGE/GAME/ARTICLE）。
- **音视频在 OneDrive 也要能在线播放**：`/od` 出口按扩展名分流——音视频走代理转发（自定 MIME + `Content-Disposition: inline` + `Accept-Ranges`，`Range`/`Content-Range` **必须透传**，206 原样返回），其余仍 302 到预鉴权下载地址（不为附件转发字节）。
  - 测试「路径穿越」别用 HTTP 客户端：fetch/undici 与 Next 路由都会**先折叠 `..`**，看到的 200 是折叠后的合法 key。要么裸 socket + 让上游桩回显收到的路径，要么别断言这一条。

## 本地文件读写路径（打包器文件追踪）
- 追踪只能静态分析 `path.join(process.cwd(), "<字面量>", 动态尾段)`。路径一经函数（`path.resolve(root, rest)`）计算，就退化成「追踪整个项目」并在 build 打出 `Warning: Dynamic filesystem access`（把 public 与全部源码都算进产物）。
- 规矩：**字面前缀留在真正调用 `fs` 的地方**（`src/app/api/dl/route.ts` 已改）。越界靠「结果一定拼在 `public/<sub>/` 之下」在结构上排除（`safeRel` 拒 `..`/NUL/空、`\` 统一成 `/`），不要再用「abs 前缀比较」兜。

## 首页板块「加载更多」
- `list` 板块追加方式 = `paged`（开关）+ `loadMode: "button" | "infinite"`（默认 button），后台 `/admin/site` 三选下拉。
- **别把 `paged` 合并成单字段**：存量 JSON 只有 `paged`，保留才能零迁移兼容。
- `useLoadMore`（`src/lib/hooks/use-load-more.ts`）page/done 用 ref、并发用 ref 闩 —— 常驻 IntersectionObserver 闭包里用 state 会取到旧页并追加重复卡片，别退回 state。
- 无限滚动哨兵 effect 依赖要带 `more.length`，否则内容不足一屏时不会自动补页。

## 本机验证环境（务必沿用）
- **PowerShell 工具吞 stdout**（裸命令、`Write-Output`、`Out-File` 都拿不到；`cmd /c "... > f"` 被沙箱拦）；`Remove-Item` 对仓库内文件静默失败 → 删除用 `node -e "fs.unlinkSync/rmSync"`。
- **bash 工具的 `rm` 是坏 shim**（`safe_delete_main: command not found`）且缺 `head`/`ls`/`grep`/`tail`。查文件用 Read、搜内容用 Grep、批量文件操作用 node 一行脚本。`cd X && node -e "..."` 与 `for` 循环可用。
- 校验 runner 写 `%TEMP%`（别放仓库根，`git status` 会被长期污染），用 `execFileSync(process.execPath, [...], {cwd, encoding:"utf8"})` 包 tsc/eslint 再打印，跑完删。
- 校验命令：`node_modules/typescript/bin/tsc --noEmit`、`node_modules/eslint/bin/eslint.js src`。**tsc 应零错误；eslint 存量有 3 条 no-unused-vars warning**（`src/app/admin/media/page.tsx` 的 `enumParam`、`src/components/auth/PublishForm.tsx` 的 `draftCount`、`src/components/sidebar/SiteSidebar.tsx` 的 `authed`），都在未改动文件里，别顺手改、也别新增。
- 无浏览器验证流程见 skill `pixel-hub-verify`（铸管理员 cookie 走 HTTP / jsdom 挂组件 / 反证断言）。

## 临时脚本纪律
- 验证脚本一律 `_` 前缀放 `prisma/`，**用完立即删**；删除未提交文件前先 `copyFileSync` 到 `%TEMP%`（git 无法恢复）。
- **探针曾被误提交**（`c01bd55` 把 `prisma/_od.ts`、`_odstub.cjs`、`_up4.ts` 一起带进了 git）。
  提交前必须 `git status --short` 逐行确认、**只 add 本次任务的文件**，绝不用 `git add -A` / `git add .`。
- `.workbuddy/` 是项目数据**不是缓存**，git status 显示删除也不要顺手清理；全部受 git 跟踪，误删用 `git checkout -- .workbuddy/` 恢复。
