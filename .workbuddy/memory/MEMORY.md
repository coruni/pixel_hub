# PixelHub 长期约定

## 验证
- 只跑 `tsc --noEmit` + `eslint`；不写探针、不做反证。探针放 `prisma/_*` 用完立即删（环境会自动 commit）；不整文件 `prettier --write`。DB 是远端 Supabase，偶发断连重跑即可。
- 改 Tailwind class 必用 postcss 实编 `globals.css` 确认产出：产物里类名的 `.` 转义成 `\.`（按 `.p-1.5` 查会假失败）；探针的类名走 `process.argv` 传，否则 Tailwind 会拿探针自己当调用点，检查永远通过。

## 迁移 / 部署
- **DROP 类破坏性迁移必须与代码分两批**：先上线不含该引用的代码、确认线上跑的是新镜像，再 DROP（事故：旧镜像 JOIN 已删的 `ResourceVersion` → 详情页全挂；止血＝建回空表）。
- 线上是外部主机容器（只有 `Dockerfile`）→ 改完提醒用户重建镜像。

## UI 语言
- 像素风 + Fusion Pixel + 点阵背景 + 赤陶橙 brand + 全站 `rounded-none`；类型图标唯一来源 `resource/type-icon.tsx`；按钮走 `<Button variant size>` 两轴字典。
- 暗色只覆盖部分阶：brand 50–900 全、neutral 200–950（50/100 单独重定义）、red 50/100/200/300/600/700、amber 100/200/300/600/700/900；emerald/sky 无覆盖。
- 分隔线统一 `border-*-2 border-dashed border-brand-300`（列表 `divide-y-2 divide-dashed`）。「评论框」= `rte/MdEditor.tsx` 根 div（`MdEditorLazy.tsx` 占位同款）；后台/登录页的 `border-brand-200` 是另一套。

## 主页背景（双槽）
- 桌面 `profileBgPcKey` / 移动 `profileBgMobileKey` 各配遮罩，**不跨槽回落**；`profileBgOnResource`/`profileBgGlobal`/`bgMinLevel` 共用。遮罩类在 `globals.css` 的 `.profile-bg-pc`/`.profile-bg-mobile`。
- **`safeBgMask(raw, slot)` 的 slot 不能省**：返回值内联传 `--profile-bg-mask` 压过类默认值，传错槽位不报错、只静默套错形状。owner 压 global 按断点成对写（`:has()` 不看 display）。
- `profileBgGlobal` 是**自见**开关；`profileBgOnResource` 是唯一让访客背景让位的开关（作者本人不受约束）；别人的主页 `GlobalProfileBg` 显式 `return null`。

## 权限与运营标记
- `adminOnly`：置顶/精华/角色/封禁/免审。`staff`：审核打回下架恢复、举报、`setResourceFlags`。可见性开关文案唯一来源 `wizard-shared.tsx` 的 `PUBLISH_OPTIONS`；后台写布尔开关逐字段取值，不要 spread。
- `pinnedAt`/`featuredAt`（null=未标记、不加索引）是 `getFeed` 第一排序键 `pinnedAt DESC NULLS LAST`（`nulls:"last"` 必写）；`pinFirst` 只在按内容打分处关。
- keyset 游标必须与 orderBy 同构（`FeedCursor.p` + `cursorAfter` 的置顶层/secondaryAfter），改排序键两处一起改，否则翻页重复/漏行/空白且不报错。
- 角标四处：`ResourceCard`、`ResourceRow`、`detail/parts.tsx` 的 `DetailMarks`（四模板共用，banner 传 `tone="dark"`）。精华发 FEATURED 积分（唯一索引去重，自点被拦）；「加入专题」追加进**第一个** featured 板块（上限 24）。打赏唯一入口 = 详情页 `ActionBar`（作品维度）。

## Prisma
- 事务内**不许 `create().catch()` 兜唯一键冲突**：PG 报错即整事务 aborted（之后全 25P02），真根因被盖掉。用 `createMany({skipDuplicates:true})` 靠 `count` 判断（见 `_tags.ts`）。find-or-create 按**所有**唯一键查；关联表按解析出的 id 去重。
- **标签 slug 相同就是同一个标签**（`/tags/{slug}` 是公开 URL），直接合并；`findOrCreateTag` 命中链 name → slug → create。

## Markdown
- `react-markdown` 基线 CommonMark，表格靠 `remark-gfm`（整体开关）。`rte/Markdown.tsx` 的 `gfm?` 默认 false，**只资源正文**开、评论关（`Comments.tsx` 同步关表格）。脚注标题带 `sr-only`（仓库没这个类）要在 `.md-body` 自己写。- 代码色 token 在 `:root`、无 dark 覆盖：`--md-code-bg`=brand-200（行内）、`--md-code-block-bg`=brand-100 + `--md-block-border`=brand-300（`pre`/表头格线）。别改回中性灰。

## 音视频
- **`source` 已删**，站内/外链看是否以 `/` 开头；**音频无嵌入页**（MUSIC 恒 `mode:"direct"`，VIDEO 保留 embed），形态用 `suggestMode(url,kind)` 自动推断。
- **`artist`/`duration`/`resolution` 已整体删除**（含 `tracks[].duration`），`lib/av-probe.ts` 只剩 `capturePoster`。**播放器时长是媒体元素自报的，别删。**
- 字幕/歌词与播放项一一对应：`meta.caption` + `tracks[].caption`，无 `label`/`captions[]`；读取层兼容旧 `captions[]`（取 `[0]`）；`migrate-av-caption.ts` 兼做 meta 一次性规整。
- 表单：主来源 `avUrl`/`avTitle` + 隐藏 `avCaption`；其余行隐藏 `avTracks`(JSON) + `avMode`。
- **行编辑器 `av-row.tsx` 只有两层**（`编号·标题·[字幕入口]·[删除]` / `地址+上传`）：输入框用 `wizInputSm`（矮一档，**别拼 `wizInput`** —— padding 同组属性并存）；`wizBtn` 已删（`py-2 text-sm`，比字典的 `sm` 还高，是行高膨胀来源）。
- **字幕 / 歌词在抽屉 `caption-drawer.tsx` 的 `CaptionDrawer`**（旧 `caption-section.tsx` 已删）：`open=false` 不渲染；入口是行尾图标按钮（已挂载 = brand 底 + 角标）。值仍**受控**（宿主持值），自持 state 会在行增删时错位。两个坑：抽屉 fixed 但**仍挂在 `<li>` 的 DOM 子树里** → `av-row` 的 `useFileDrop` 必须 `disabled: uploading || capOpen`（否则拖 .srt 冒泡上去被当视频传）；`onClose` 必须 `useCallback` 稳定，否则抽屉 effect 重跑反复抢焦点（关闭时把焦点还给入口按钮）。
- `meta.tracks` 不含主来源那一 P；拼装唯一入口 `lib/av-tracks.ts` 的 `avPlaylist()` = `[主来源, ...tracks]`，主来源 = P1。切 P 只改 `src`+`load()`，**不要 `key={src}` 重挂载**；视频分P 控件在画面浮层；`av-embed.tsx` 只服务多 P 视频。
- 字幕唯一事实来源 `lib/captions.ts`（`meta.ts → captions.ts` 单向），文本**内联**在 meta（`/od/…` 302 到无 CORS 链接）。自绘不用 `<track>`；音频歌词板**滚动手算 `scrollTop`、禁 `scrollIntoView`**；按钮原语 `av-btn.tsx`。
- `parseMeta` 降级链：整块 → 丢 captions → 再丢 tracks → 兜底。AV meta 不接受 `license`/`note`。标题自动填 `lib/av.ts` 的 `avTitleFromFile(name)`（只在空或等于上次自动值时写入）；整行可拖拽 + 上传进度条。
