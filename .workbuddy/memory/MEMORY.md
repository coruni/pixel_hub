# Pixel Hub —— 长期项目约定

## 图片压缩（重要，改动前必读）
- 所有服务端图片压缩必须走 `src/lib/media/compress.ts` 的 `compressWith()`，禁止在业务代码里直接写 `.webp()/.jpeg()/.png()`。
- alpha 通道规则：webp 锁定 `alphaQuality: 100`；png `quality<100` 用 `palette: true` 量化（带 alpha 支持）、`quality=100` 走无损；jpg 无 alpha，必须先 `flatten({ background: "#ffffff" })` 合成白底再编码（否则透明区域变黑）。
- 压缩参数来源：`SiteSetting["uploadLimits"]` 的 `imageFormat`（webp/jpg/png，默认 webp）与 `imageQuality`（1..100，默认 82），后台入口 `/admin/uploads` 的「图片压缩」区块。
- 缩略图质量 = 主图质量 − 8（下限 40，默认 82 → 74），保持与原硬编码值一致。
- 落盘 key 的扩展名必须与输出格式一致（local/s3/chevereto 驱动按 key 扩展名识别 content-type）。
- 回归验证：`npx tsx _test/compress-alpha.ts`（断言 webp/png 保留 alpha、jpg 合白底、缩略图降档）。

## ImageViewer（src/components/ui/ImageViewer.tsx）
- 平移能力按「可平移空间」（`panBounds`/`canPan`）判定，不用 `zoom > 1` 当代理条件：缩小时同样可拖动。
- 位移必须在 `applyZoom`/`rotateBy` 后重新夹取，否则放大拖动后再缩回会停在偏移位置。
- react-hooks v7 的 immutability 规则不允许在 useCallback/useEffect 中写 `useRef.current`（仅 useLayoutEffect 内允许），需要随渲染变化的镜像值优先直接读 state。

## UI 文案（tip / 提示）取舍
- 判断标准：只讲「怎么操作」、而该操作已由可见控件表达的文案＝多余 tip，不写（如「点击卡片进入填写」「向下滚动加载更多」「悬停查看数值」「点保存上传」）。
- 必写的四类：配置含义、约束（尺寸/格式/上限）、状态反馈（加载/空/错误/权限）、行为后果（保存后会发生什么）。
- 图标按钮的 `title` 是**无障碍名称**，属必留项，不要当 tip 删除，否则违反 a11y 红线。
- 现有写法沿用：admin 表单的 `hint` 字段、settings 页 `sectionHint`（`mb-4 mt-1 text-xs text-neutral-400`）、admin 页首说明框（`rounded-none border border-brand-200 bg-surface px-4 py-3 text-xs leading-5 text-neutral-500`）。
- 无限滚动哨兵（`feed/FeedInfinite.tsx`）：删掉提示文案后容器必须保留高度（现为 `mt-6 flex h-8 items-center justify-center`），否则 IntersectionObserver 目标塌陷。

## CSS 层叠层与「无层优先」（踩过的坑）
- `globals.css` 里写在 `@import "tailwindcss"` **之后**的规则是无层的；Tailwind 工具类落在 `@layer utilities`。层叠层序中**无层优先于任何分层**，这一层判断在特异性之前生效。
- 与全局无层规则冲突时（典型：`* { scrollbar-width: thin }`），Tailwind 的任意值写法（中括号）会被静默压掉。解法：在 `globals.css` 补一个无层普通 class（现有 `.scrollbar-none`），不要指望 JSX 里的任意值类。
- 另外：`globals.css` 的注释里也不要写出中括号类名原样（Tailwind 会扫描注释当候选类，凭空生成一条无用规则）。
- 横向滚动 + 下划线 tab：`overflow-x-auto` 会把 overflow-y 算成 auto 并裁掉自身溢出，所以 `-mb-px` 必须挂在滚动容器上，挂按钮上会被裁掉 1px。

## 附件上传区域：统一入口与清单容器
- **唯一上传按钮组件** = `src/components/upload/AttachmentUpload.tsx` 的 `AttachmentUpload`（导出 `AttachLimits` 类型）。全站任何「选文件上传附件」入口都必须复用它，禁止再手写 `<label>` + `<input type="file">` 的按钮样式。
  - 收口四态：可上传 / 拖拽悬停（`dragging` + `dropProps`）/ 上传中（`progress`）/ 已上传回执（`filled`）；提示文案由 `limits` 驱动，`hint` 追加「可多选」等补充。
  - **`accept` 必须按 kind 分派**（踩过的坑）：组件默认用后台「附件后缀表」生成 accept，MUSIC/VIDEO **必须**显式传 `accept={avAcceptAttr(kind)}` —— 服务端对 kind=music|video 是按 `avExtsFor(kind)` 放行的（m4a/aac/opus/m4v/mov/ogv 都不在附件表里）。两边不一致 = 合法文件在文件选择器里选不中；后台一旦把附件后缀改窄，音视频会**完全无法上传**，而 `hint` 还照着 `avExtsSample(kind)` 显示允许后缀，文案与行为直接矛盾。
  - **进度参数别混用**：单文件字节进度走 `percent`（0..100）；`progress({done,total})` 是**批量**语义，会被渲染成「第 n / 共 m 个文件」。把百分比塞进 `progress` 只会显示「上传中 45/100…」并且真正的进度条不出现。
  - `multiple` 决定单选/多选；内部已 `e.target.value = ""`（否则同一批文件第二次选择不触发 change），调用方不要再清一遍。
  - `wizard-sections.tsx` 里同名的 `AttachmentUpload` 是它的薄包装，保留只为兼容 GameSection 的多选进度语义，不要再往里加样式。
- **清单编辑器** = `AttachmentListEditor`（IMAGE 图包 / ARTICLE 文末附件 / GAME 下载源共用）。新增同类清单一律走它，不要复制行布局。
  - **主入口是拖拽/点击投放区**（`AttachmentUpload` 的 `variant="dropzone"`），不是按钮。用户明确要求「允许拖拽/点击区域上传」。
  - **上传任务与抽屉解耦**（关键设计）：`onFiles()` 拖入即开始上传，**不等抽屉**；抽屉关掉也不中断在飞任务；上传完成后该文件直接成为 `rows` 一行，并在抽屉空闲时自动打开它填标题。
  - **上传中可以继续拖入**：`useFileDrop({ disabled })` 只挂钩 `rows.length >= 20`，**不要挂钩 busy**——否则「关掉抽屉后继续上传」无从操作。进度计数用 `doneRef`/`totalRef` 累计（新一批不能冲掉旧一批的计数），不要每批重置。
  - **提交必须有闸门**：`AttachmentListEditor` 通过 `onBusyChange(inflight)` 把在飞数量交给宿主；宿主（`UploadWizard` / `ResourceEditForm`）禁用提交按钮 + 在 `<form onSubmit>` 里 `preventDefault()` 兜住回车提交。**新增任何带附件清单的表单都要接这个回调。**
  - 抽屉用「草稿」模型（`open` 编辑既有行 / `draft` 新增草稿，互斥）：只有点「添加」且内容有效才 `setRows`，所以点按钮不会多出空行。抽屉占用与否在上传回调里必须读 `drawerHeldRef`（async 闭包读 state 会拿到旧值）。
  - 抽屉底部主按钮：`isNew` → 「添加」走 `onCommit`；编辑既有 → 「完成」走 `onClose`。Esc / 点遮罩 = 取消草稿。
  - 对齐三要素：`addLinkLabel`、`showSize`、`emptyHint`。GAME 与 ARTICLE 现取同值（`"添加下载源"` / `showSize={false}` / 各自语义化空态）。
  - ARTICLE 与 GAME 都用「`rounded-none border border-brand-200 p-4` 描边盒 + `text-sm font-medium text-neutral-700` 小标题」包住编辑器；ARTICLE 因可选故标题不带红色星号。
- `media-picker.tsx` 是「图片缩略图网格投放区」，**不属于附件按钮**，不要合并进来。
- `av-section.tsx`（MUSIC/VIDEO）的 `AttachmentUpload` 是**单文件直传**场景（直接写 `avUrl`，没有清单/抽屉），保持独立，不要套用上面的草稿模型。

## 详情页操作条（ActionBar / ACTION_TEXT）—— 用户明确要过，别改回去
- 形态 = **「图标 + 文字」**：Heart / Star / Flag / Pencil，`size={15}`，一律 `aria-hidden`（无障碍名称只由文字承担）。曾经提交过的「纯文字、无图标」版本已被用户否掉（`74f4c4f` 那次），不要再退回无图标写法。
- `ACTION_TEXT`（`src/lib/ui/cls.ts`）= 动作项样式：无边框、无底色、`gap-1.5 py-1.5 text-sm`（32px 高，满足 WCAG 2.5.8 的 24px 触控下限）。`FollowButton` 是全站唯一保留描边/实底的动作（详情页唯一主转化），不要一起文字化。
- `ActionBar` 行容器用 `justify-end`（**收在右边**）——用户原话「点赞 actions 放右边，符合操作习惯」；下面那句「作者已关闭评论。」跟着 `text-right`，否则会跟右对齐的行错开。状态仍走文案 + 颜色双通道（点赞↔已赞 / 收藏↔已收藏），不靠颜色单通道。
- **模板里的落位**（关键，用户纠正过两次，别改回去）：banner 模板的 `<ActionBar>` 要落在 **`DownloadPanel` 之后、`DescriptionBlock` 之前**（即「描述上边」），并且必须在两栏网格 `CollapsibleAside` **之外**——塞进图集左列时 `justify-end` 只能顶到 340px 侧栏的左边缘，够不到版心右侧（用户原话「独立在banner外，不然没办法直接到右边」）。用户先说「banner 下边」，我理解成「紧跟横幅、图集上方」是错的；他要的是图集/侧栏那块之后、贴在描述上方。post 在右栏底部（已右对齐）、article 是居中栏、twocol 仍在左列内。
- **`CollapsibleAside` 收起时必须「不重排」**（用户明确要求过「修复折叠之后文字换行导致高度被撑开」）：
  - `overflow-hidden` 有 grid 容器 + `<aside>` 两层；`<aside>` 内再套一层 `<div className="space-y-4 whitespace-nowrap lg:w-[340px]">`，把内容宽度**锁死在展开态轨道宽**。关键点：光裁剪挡不住高度重排——列宽被压到 0 时内容宽度跟着变，文本逐字折行、卡片高度暴涨，会把整个 grid 行撑开（表现为页面高度抖动）。锁死宽度后内容任何时刻都在同一宽度下排版，收起只是「看不见」而非「重新排版」。
  - `whitespace-nowrap` 另挡长值（平台串/分类名）在 340px 内的折行抖动；代价是超长文本被硬切——侧栏是概览不是正文，刻意取舍。
  - 340 这个值出现在 `RAIL_OPEN` / `RAIL_SHUT` / `RAIL_BOX` / 把手 `style.right` 四处，已用文件顶部常量 + **完整类名字符串**集中（不能拼接：Tailwind 只扫字面量，写成 JS 模板拼类名会静默不生成规则）。
  - `DetailTwocol` 的 360px `<aside>` 尚未同步加固。

## 详情页模板是高发改动区（回退要按文件粒度）
- 四种模板共用 `src/components/resource/detail/parts.tsx` 的部件，改一处全站生效；`detailTemplate.byType` 后台可配，所以任何模板改动都要考虑「换个类型套同一模板」的情形（典型：信息面板标题不能写死「游戏信息」）。
- **回退不要按目录**：`git checkout HEAD -- src/components/resource/detail/` 会一次带走该目录下**所有**未提交改动（曾连带撤掉用户自己提的「右栏下移 + 去折叠」）。回退前先 `git diff --stat` 看清范围，并把现场备份到 `%TEMP%`。

## 本机验证环境（务必沿用）
- **PowerShell 工具在本机吞 stdout**：裸命令、`Write-Output`、`Out-File` 都拿不到内容，`cmd /c "... > f"` 被沙箱拦。
- **PowerShell 的 `Remove-Item` 对仓库内文件静默失败**（以为删了其实还在）。删除仓库内文件用 `node -e "fs.unlinkSync(...)"` / `fs.rmSync(dir,{recursive:true})`。
- **bash 工具的 `rm` 是坏 shim**（报 `safe_delete_main: command not found`），且缺 `head`/`ls`/`grep`/`tail`；查看文件用 Read 工具。bash 支持 `cd X && node -e "..."` 与 `for` 循环，校验脚本用这个最稳。
- 校验做法：把 runner 写到 **`%TEMP%`**（不要放仓库根目录，否则 `git status` 长期被污染），内容用 `execFileSync(process.execPath, [...], {cwd, encoding:"utf8"})` 包 tsc/eslint 再 `console.log`，跑完删掉。
- 校验命令：`node_modules/typescript/bin/tsc --noEmit`、`node_modules/eslint/bin/eslint.js`。
- **`tsc --noEmit` 当前应为完全零错误**（原 `prisma/_dl.ts(166,9)` 那条例外是临时脚本，已随清理删除）。

## 临时脚本纪律
- 验证脚本一律 `_` 前缀 + 放 `prisma/` 或 `%TEMP%`，**用完立即删**；此前积累过 18 个未提交脚本被一起清掉。
- 删除未提交文件前先备份（`copyFileSync` 到 `%TEMP%`），因为 git 无法恢复。
- `.workbuddy/` 是项目数据**不是缓存**，即使 git status 显示为删除也不要顺手清理——memory 文件全部受 git 跟踪，误删可用 `git checkout -- .workbuddy/` 恢复。

## 首页板块「加载更多」（home-config 的 list 类型）
- `list` 板块（label「内容流板块」）追加方式 = `paged`（开关）+ `loadMode: "button" | "infinite"`（默认 button）；后台 `/admin/site` 里是一个三选下拉。
- **别把 `paged` 合并成单字段**：存量 `HomeSection.config` JSON 里只有 `paged`，保留它才能零迁移兼容（新键有 default 兜底）。
- `useLoadMore`（`src/lib/hooks/use-load-more.ts`）里 page / done 用 ref、并发用 ref 闩——无限滚动把 `loadNext` 交给常驻的 IntersectionObserver 闭包，用 state 会取到旧页并追加重复卡片。动这个 hook 时不要退回 state。
- 无限滚动哨兵观察器的 effect 依赖要带 `more.length`，否则内容不足一屏时不会自动继续补页。
