# PixelHub 长期约定

## 验证 / 部署
- 只跑 `tsc --noEmit` + `eslint`；不写探针、不做反证。探针放 `prisma/_*` 用完立即删（环境会自动 commit）；别整文件跑 `prettier`。DB 是远端 Supabase，偶发断连重跑即可。
- 改 Tailwind class 用 postcss 实编 `globals.css` 确认产出；探针类名走 `process.argv`；变体类产物里是 `.hover\:x:hover`。
- **DROP 类破坏性迁移与代码分两批**：先上线不含该引用的代码、确认线上跑新镜像再 DROP。线上是外部主机容器（只有 `Dockerfile`）→ 改完提醒用户重建镜像。
- **图片「首开全裂、刷新才好」= `net::ERR_CONNECTION_RESET`（连接被掐），不是 404/URL 错**。两层处置：① `server.js` 的 `keepAliveTimeout` 必须**长于前置代理的上游空闲超时**（Node 默认 5s，代理常留 60s+ → 源站先关、代理不知情、请求发到死 socket → RST），已设 5min + `headersTimeout` 加 1s，优雅退出补 `closeIdleConnections()`；② 全站兜底 `layout/ImageRetry.tsx`：捕获阶段收 `error` + **挂载时补扫 `complete && naturalWidth===0`**（RST 秒回，首屏那批的失败在 hydration 之前，只挂监听器会漏），站内相对地址重发带 `?imgretry=N`、外链不动 query，最多 2 次。CSS `background-image` 不在覆盖范围。若 RST 仍在 → 查容器是否被杀（`RestartCount` / 137）或代理侧重置，代码改不掉。

## UI 语言
- 像素风 + Fusion Pixel + 点阵背景 + 赤陶橙 brand + 全站 `rounded-none`；类型图标唯一来源 `resource/type-icon.tsx`。
- 暗色只覆盖部分阶：brand 50–900、neutral 200–950、red 50/100/200/300/600/700、amber 100/200/300/600/700/900；emerald/sky 无覆盖。提示文字统一 `text-amber-600`。
- 分隔线统一 `border-*-2 border-dashed border-brand-300`（列表 `divide-y-2 divide-dashed`）；**同组属性别拼**（padding/margin 并存靠产物顺序定胜负）。

## 背景层（双槽 + 简洁模式）
- 双槽 `profileBgPcKey`/`profileBgMobileKey` 各配一份遮罩、**不跨槽回落**；`profileBgOnResource`/`profileBgGlobal`/`bgMinLevel` 共用；遮罩类 `.profile-bg-pc`/`.profile-bg-mobile` 在 `globals.css`。
- **`safeBgMask(raw, slot)` 的 slot 不能省**：返回值内联压过类默认值，传错槽位静默套错形状；owner 压 global 按断点成对写（`:has()` 不看 display）。
- `profileBgGlobal` 是**自见**开关；`profileBgOnResource` 是唯一让访客背景让位的开关（作者本人不受约束）；别人主页 `GlobalProfileBg` 直接 `return null`。
- **简洁模式**：偏好存 cookie（`lib/simple-mode.ts`），未登录也能用、layout 读得到 → SSR 首帧即带 `<html data-simple-bg>` 零闪烁。CSS `html[data-simple-bg] [data-profile-bg-*]{display:none}` **故意不放进 layer** 才能压住 `sm:block`；`GlobalProfileBgLoader` 开头短路；两处入口靠 `simple-bg-change` 同步。

## 权限与运营
- `adminOnly`：置顶/精华/角色/封禁/免审。`staff`：审核打回下架恢复、举报、`setResourceFlags`。可见性开关文案唯一来源 `PUBLISH_OPTIONS`（`wizard-shared.tsx`）；后台写布尔开关逐字段取值，不要 spread。
- `pinnedAt`/`featuredAt`（null=未标记、不加索引）是 `getFeed` 第一排序键（`nulls:"last"` 必写）；`pinFirst` 只在按内容打分处关。keyset 游标必须与 orderBy 同构（`FeedCursor.p` + `cursorAfter`）。
- 置顶/精华角标共四处：`ResourceCard` / `ResourceRow` / `DetailMarks`（四模板共用，banner 传 `tone="dark"`）；精华发 FEATURED 积分（唯一索引去重）；「加入专题」进第一个 featured 板块（上限 24）。

## 上传 / 去重
- **图片去重指纹 = 压缩前源字节的 sha256**（`media/checksum.ts`，落在 `Media.checksum`）。附件那套「同用户 + 同名 + 同大小」对图片无效：sharp 会重编码，`Media.size` 是**产物**字节数。命中后**复用旧存储对象、另建一条 Media 记录**（`resourceId`/`commentId` 是单值列，复用同一行会把图从上一个资源抢走）。scope 分 `gallery` / `comment`（后者额外要求 `commentId != null`，别复用「原样落盘未缩图」的附件行）。
- **指纹现在由前端算原始字节、随上传提交**：前端 `lib/media/client-compress.ts` 的 `compressImageForUpload` 在压图前先对**原始 File 字节**取 sha256（`crypto.subtle.digest`），压完把 `file` 与 `checksums`（同序）一起发给服务端。服务端 `/api/upload` 与 `saveCommentImage` 收到合法 64-hex 指纹就用它做去重，否则回退 `sha256Hex(收到字节)`。这样老记录（指纹=原图 sha256）与新上传依然能对上，跨版本去重不失效；非安全上下文（非 localhost/https）拿不到 subtle，回退照常。
- **前端预压缩（2026-10-01 新增）**：目的砍掉 10MB+ 原图的上传体积 / 服务端 sharp 解码压力，并丢 EXIF。规则：≤200KB 不压；gif 不压（canvas 只取首帧会丢动画）；解不出或没压小则降级用原文件。其余图 `createImageBitmap`+canvas 重编码，优先 webp（保透明），老浏览器退回 png（源带透明时）/jpeg（源 jpeg 时，带透明则先铺白底）；最长边 >4096 等比降到 4096 以内（挡 100MP 手机照，正常照片原分辨率归档语义不变）。三个调用点：`upload-image-client.ts` 的 `postOnce`、`MdEditor.tsx` 的 `onUpload`、`Comments.tsx` 的 `post`（主楼附图）。服务端 `processImage` 仍照常出原图/大图/缩略图/水印。
- **共用存储对象是连带约束**：删记录前必须反查引用（`admin-media.ts` 的 `purgeFiles(mediaId, keys)`，被别处引用的 key 不删），桶用量必须按 `storageKey` 去重（否则一张图重复计入、桶提前报满）。新增「多行指同一对象」的写法时要顺着这两处一起看。

## 存储 / S3 多桶
- 落库一律是**完整 URL**（s3 的 `put` 返回 `${publicBase}/${key}`，不是相对 key）→ 桶信息自带在 URL 里，加桶/换桶不影响存量数据，`publicUrl` 对 URL 原样返回。但 `get`/`size`/`del` 必须反解出桶，唯一入口 `storage/s3-key.ts` 的 `resolveS3Target(key, specs)`（纯函数：命中公开基址或 `Endpoint/Bucket` 取**最长**命中；相对 key 归主桶；陌生域 best-effort 兜主桶）。
- 生效桶链唯一入口 `s3BucketSpecs`/`s3UploadBuckets`（runtime-config）：备用桶**逐字段继承**主配置（Endpoint/Region/凭据/公开基址），留空即继承、填了即独立 —— **每个桶可以是不同账号/密钥甚至不同服务商**；只有 `bucket` 必填。可见性 `aclMode`、寻址风格 `urlStyle` 是**三态**（`""` = 跟随主桶 / `public`|`private` / `virtual`）；`""` 必须存在，布尔表达不了「没填」。上传按「主桶 → 备用桶 1…N」取第一个未标 `full` 的，写失败自动换下一个（缺 publicBase 的桶**先跳过**，否则会留下删不掉的孤儿对象），全满则抛明确错误。两桶 publicBase 相同会串桶（反解按最长命中）→ `runtimeConfigIssues` 已拦。
- 后台字段 `s3BucketFull` + `s3ExtraBuckets`（上限 8，常量在 `storage/bucket-limits.ts`；客户端组件只 import 这个常量，**类型**才能 import runtime-config，否则 prisma 进浏览器包）。`/api/dl` 白名单要把每个桶的 publicBase **和** Endpoint 主机都登记，否则备用桶里的文件下载 403。
- 旧实现删 S3 对象时把整条 URL 当 Key 传（等于没删），现由反解修好。
- **「满了切下一个」有三个触发点**（s3.ts 文件头有记）：人工 `full` 标记 → **容量预检** → 写入抛错。S3 协议**没有容量查询 API**，所以「桶还能装多少」必须自己算：每桶可配 `s3MaxGb` / `entry.maxGb`（GB 字符串，空=不限，换算 `gbToBytes`），上传前按「已用 + 本次大小」预检，装不下就跳。**这是「免费额度用完但绑了卡、服务商照写照计费且不报错」的唯一防线**（其余两个触发点都覆盖不到）。用量在 `storage/bucket-usage.ts`：按 `Media.size` 反解桶求和 + 60s 进程内快照 + 并发去重 + 写后 `bumpUsage`；`s3HasCapacityLimit()` 为假时零查询（不配置=与升级前零差别）。口径：`used+incoming > cap` 才跳（正好填满允许），`storageKey startsWith "http"` 排除云盘/本地文件，缩略图字节没算（近似值）。
- **容量上限必须能在保存时报错，不能在 sanitize 里静默收敛**：曾用 `normGb()` 把非法值清成 `""` → 校验函数永远看不到非法值（探针逮到 2 条恒 false 断言），且用户以为有防线其实没有。现在 sanitize 只 trim+截长，`isInvalidGb()` 在 `runtimeConfigIssues` 里报错。

## Prisma
- 事务内**不许 `create().catch()` 兜唯一键冲突**：PG 报错即整事务 aborted（之后全 25P02）。用 `createMany({skipDuplicates:true})` 靠 `count` 判断（见 `_tags.ts`）。find-or-create 按**所有**唯一键查；关联表按解析出的 id 去重。
- **标签 slug 相同就是同一个标签**（`/tags/{slug}` 是公开 URL），直接合并；`findOrCreateTag` 命中链 name → slug → create。

## Markdown
- `react-markdown` 基线 CommonMark，表格靠 `remark-gfm`（整体开关）；`rte/Markdown.tsx` 的 `gfm?` 默认 false，只资源正文开、评论关。脚注标题的 `sr-only` 仓库没有，要自己写。代码色 token 全在 `:root` 且均引 brand 阶，别改回中性灰。

## 音视频
- `source` 已删（站内/外链看是否以 `/` 开头）；音频恒 `mode:"direct"`（无嵌入页），VIDEO 保留 embed。播放器时长由媒体元素自报、别删。
- 字幕与播放项一一对应：`meta.caption` + `tracks[].caption`（读取层兼容旧 `captions[]` 取 `[0]`）。表单字段：`avMode` + 主来源 `avUrl`/`avTitle`/`avCaption` + 其余行 `avTracks`(JSON)；`meta.tracks` 不含主来源那一 P，拼装唯一入口 `avPlaylist()`。另有 `meta.downloads` 下载源（AV 也能挂，写入侧早已透传，详情页 `DownloadListCard` 统一渲染）。
- **`av-row.tsx` 只剩「编号 · 标题 · 设置图标」**（行仍可拖放上传）：改标题/地址/上传/字幕全在 `av-item-drawer.tsx`（`open=false` 不渲染），字幕体是 `caption-field.tsx`。**主来源 `avUrl`/`avTitle` 由 `av-section` 隐藏字段提交**（抽屉关着不渲染，挂在行里一关就丢值）。行上仍摊三样：上传进度/结果（抽屉开着归抽屉）、字段错误、有内容没地址的预警。
- 抽屉坑：① `fixed` 但仍在 `<li>` 子树里 → 行上 `useFileDrop` 要 `disabled: uploading || open`；② `onClose` 需 `useCallback` 稳定，否则 effect 重跑抢焦点。**投放区不许嵌套**：冒泡会让一个 .srt 被内外各接一次；给内层 `stopPropagation` 又会挡掉外层那次 drop，而浏览器 drop 后**不补发 dragleave** → 外层高亮永久卡死，故 hook 刻意不给这个开关。
- 投放区（拖入即替换）**只有三处**：行 `<li>`（抽屉关着时）、抽屉里「地址框 + 上传按钮」那块、`caption-field.tsx` 的**内容区**（不含上面那行「字幕/歌词 + 提示」）。`av-section` 上没有任何投放区 —— 后两条都是用户明确要求。
- 投放区视觉：拖拽态 `border-dashed border-brand-500 bg-brand-50`，**边框宽度须与常态相同**（一变就位移 → enter/leave 抖）。抽屉那块常态挂 `border-2 border-transparent`，padding 1.5(6px)+2px = 原 8px；字幕区常态无边框，改用 `outline-2 outline-dashed outline-offset-2 outline-brand-500`（outline 不占布局；`outline-2` 的 style 取 `var(--tw-outline-style)`，由 `outline-dashed` 提供）。横向留白用 `-mx-2` 不用 `-m-2`（与父 `space-y-*` 的 margin-top 撞同组）。
- 切 P 只改 `src`+`load()`，**禁用 `key={src}` 重挂载**；**画面上一律不留浮层按钮** —— 上一/下一、字幕开关、选集开关全在底部控件行（直链播放器与 `av-embed` 一致）。控件行分「左组（上/下一 + 播放 + 时间）/ 右组（显示 + 设置）」两个容器 + `flex-wrap`：窄屏放不下时右组整体折到第二行，宽屏 spacer 顶到两端。分P 列表面板打开时控件条整条让位；面板窄屏 `inset-x-0 bottom-0 max-h-full`（贴底铺满）、宽屏 `sm:right-3 sm:w-72 sm:max-h-[70%]`（右下浮层），header 里有收起按钮（窄屏面板盖住控件条，开关点不到）。`av-embed.tsx` 只服务多 P 视频；字幕唯一来源 `lib/captions.ts`（`meta.ts → captions.ts` 单向），文本**内联**在 meta；自绘不用 `<track>`；音频歌词板**滚动手算 `scrollTop`、禁 `scrollIntoView`**；按钮原语 `av-btn.tsx`；`parseMeta` 降级链：整块 → 丢 captions → 再丢 tracks → 兜底。
- 视频字幕叠层（`CaptionLayer`）挂在底部控件区外层、用 `bottom-full` 贴控件条上沿，且**不在**做淡出的那层里（字幕是内容，不跟控件一起消失）。
- `AvTrackList` **不再自带默认限高**（原来 inline `45vh` 会压过宿主的响应式 class）：限高由宿主 class 给 —— 音频/嵌入页 `max-h-[45vh]`，视频面板用上面的定位类。它外层是 flex-col（可选 `header` 槽位，`<ol>` 只允许 li 所以头部得放外面），`<ol>` 是 `flex-1 min-h-0 overflow-y-auto`。
- 视频控件淡出计时**必须由 effect 按 `playing`/`listOpen`/`moreOpen` 驱动**（任一面板开着都不挂计时），只在 `pointermove` 里补挂会漏「关面板」「非指针触发播放」两种；面板自行收起（点外部 / Esc）也要走宿主 `onClose` 把计时补回来。`react-hooks/set-state-in-effect` 在本仓库是 **error**，effect 里禁止同步 setState（异步 `setTimeout` 回调里的可以）。
- **「更多」溢出菜单**（`av-more.tsx`）：`AvMoreMenu`（触发按钮 + `bottom-full` 自下往上弹的面板，往下弹会被画面裁）+ `AvMoreItem`（图标/文案/hint/check，tone 由 MenuCtx 注入）。**open 状态由宿主持有**（视频淡出要读它），收起三条路径都调宿主 `onClose`。视频行收 倍速/循环/下载原件、音频行收同样三项；**全屏留在主行**（一次播放要反复按），行内保留 播放 / 上一下一 / 时间 / 字幕 / 选集 / 音量静音 / 全屏 / 更多。开关型项必须 `role="menuitemcheckbox"` + `aria-checked`（`aria-pressed` 挂 `menuitem` 会被 `jsx-a11y/role-supports-aria-props` 拦），由「是否传 `active`」判定角色。**宿主注入的下载行**走 `MetaDownloadButton menuItem`（原 `iconOnly` 已删）+ `@/lib/ui/cls` 的 `AV_MORE_ROW` / `AV_MORE_ROW_ON_DARK|ON_SURFACE`（行盒与色调，`av-more` 的 ROW 表同源，别两处抄）；颜色只给 hover/激活态，常态文字色由面板给。菜单行文案要 `min-w-0 flex-1 truncate` 才不会被长文件名顶破。
