# PixelHub 长期约定

## 验证 / 部署
- 只跑 `tsc --noEmit` + `eslint`；不写探针、不做反证。探针放 `prisma/_*` 用完立即删（环境会自动 commit）；别整文件跑 `prettier`。DB 是远端 Supabase，偶发断连重跑即可。
- 改 Tailwind class 用 postcss 实编 `globals.css` 确认产出；探针类名走 `process.argv`；变体类产物里是 `.hover\:x:hover`。
- **DROP 类破坏性迁移与代码分两批**：先上线不含该引用的代码、确认线上跑新镜像再 DROP。线上是外部主机容器（只有 `Dockerfile`）→ 改完提醒用户重建镜像。

## UI 语言
- 像素风 + Fusion Pixel + 点阵背景 + 赤陶橙 brand + 全站 `rounded-none`；类型图标唯一来源 `resource/type-icon.tsx`。
- 暗色只覆盖部分阶：brand 50–900、neutral 200–950、red 50/100/200/300/600/700、amber 100/200/300/600/700/900；emerald/sky 无覆盖。提示文字统一 `text-amber-600`。
- 分隔线统一 `border-*-2 border-dashed border-brand-300`（列表 `divide-y-2 divide-dashed`）；**同组属性别拼**（padding/margin 并存靠产物顺序定胜负，要别的尺寸单写一份）。

## 背景层（双槽 + 简洁模式）
- 双槽 `profileBgPcKey`/`profileBgMobileKey` 各配一份遮罩、**不跨槽回落**；`profileBgOnResource`/`profileBgGlobal`/`bgMinLevel` 共用；遮罩类 `.profile-bg-pc`/`.profile-bg-mobile` 在 `globals.css`。
- **`safeBgMask(raw, slot)` 的 slot 不能省**：返回值内联压过类默认值，传错槽位静默套错形状；owner 压 global 按断点成对写（`:has()` 不看 display）。
- `profileBgGlobal` 是**自见**开关；`profileBgOnResource` 是唯一让访客背景让位的开关（作者本人不受约束）；别人主页 `GlobalProfileBg` 直接 `return null`。
- **简洁模式**：偏好存 cookie（`lib/simple-mode.ts`），未登录也能用、layout 读得到 → SSR 首帧即带 `<html data-simple-bg>` 零闪烁。CSS `html[data-simple-bg] [data-profile-bg-*]{display:none}` **故意不放进 layer** 才能压住 `sm:block`；`GlobalProfileBgLoader` 开头短路；两处入口靠 `simple-bg-change` 同步。

## 权限与运营
- `adminOnly`：置顶/精华/角色/封禁/免审。`staff`：审核打回下架恢复、举报、`setResourceFlags`。可见性开关文案唯一来源 `PUBLISH_OPTIONS`（`wizard-shared.tsx`）；后台写布尔开关逐字段取值，不要 spread。
- `pinnedAt`/`featuredAt`（null=未标记、不加索引）是 `getFeed` 第一排序键（`nulls:"last"` 必写）；`pinFirst` 只在按内容打分处关。keyset 游标必须与 orderBy 同构（`FeedCursor.p` + `cursorAfter`）。
- 置顶/精华角标共四处：`ResourceCard` / `ResourceRow` / `DetailMarks`（四模板共用，banner 传 `tone="dark"`）；精华发 FEATURED 积分（唯一索引去重）；「加入专题」进第一个 featured 板块（上限 24）。

## Prisma
- 事务内**不许 `create().catch()` 兜唯一键冲突**：PG 报错即整事务 aborted（之后全 25P02）。用 `createMany({skipDuplicates:true})` 靠 `count` 判断（见 `_tags.ts`）。find-or-create 按**所有**唯一键查；关联表按解析出的 id 去重。
- **标签 slug 相同就是同一个标签**（`/tags/{slug}` 是公开 URL），直接合并；`findOrCreateTag` 命中链 name → slug → create。

## Markdown
- `react-markdown` 基线 CommonMark，表格靠 `remark-gfm`（整体开关）；`rte/Markdown.tsx` 的 `gfm?` 默认 false，只资源正文开、评论关。脚注标题的 `sr-only` 仓库没有，要自己写。代码色 token 全在 `:root`（`--md-code-bg`=brand-200、`--md-code-block-bg`=brand-100），别改回中性灰。

## 音视频
- `source` 已删（站内/外链看是否以 `/` 开头）；音频恒 `mode:"direct"`（无嵌入页），VIDEO 保留 embed。播放器时长由媒体元素自报、别删。
- 字幕与播放项一一对应：`meta.caption` + `tracks[].caption`（读取层兼容旧 `captions[]` 取 `[0]`）。表单字段：`avMode` + 主来源 `avUrl`/`avTitle`/`avCaption` + 其余行 `avTracks`(JSON)；`meta.tracks` 不含主来源那一 P，拼装唯一入口 `avPlaylist()`。
- **`av-row.tsx` 只剩「编号 · 标题 · 设置图标」**（行仍可拖放上传）：改标题/地址/上传/字幕全在 `av-item-drawer.tsx`（`open=false` 不渲染），字幕体是 `caption-field.tsx`。**主来源 `avUrl`/`avTitle` 由 `av-section` 隐藏字段提交**（抽屉关着不渲染，挂在行里一关就丢值）。行上仍摊三样：上传进度/结果（抽屉开着归抽屉）、字段错误、有内容没地址的预警。
- 抽屉坑：① `fixed` 但仍在 `<li>` 子树里 → 行上 `useFileDrop` 要 `disabled: uploading || open`；② `onClose` 需 `useCallback` 稳定，否则 effect 重跑抢焦点。**投放区不许嵌套**：冒泡会让一个 .srt 被内外各接一次；给内层 `stopPropagation` 又会挡掉外层那次 drop，而浏览器 drop 后**不补发 dragleave** → 外层高亮永久卡死，故 hook 刻意不给这个开关。
- 投放区（拖入即替换）**只有三处**：行 `<li>`（抽屉关着时）、抽屉里「地址框 + 上传按钮」那块、`caption-field.tsx` 的**内容区**（不含上面那行「字幕/歌词 + 提示」）。`av-section` 上没有任何投放区 —— 后两条都是用户明确要求。
- 投放区视觉：拖拽态 `border-dashed border-brand-500 bg-brand-50`，**边框宽度须与常态相同**（一变就位移 → enter/leave 抖）。抽屉那块常态挂 `border-2 border-transparent`，padding 1.5(6px)+2px = 原 8px；字幕区常态无边框，改用 `outline-2 outline-dashed outline-offset-2 outline-brand-500`（outline 不占布局；`outline-2` 的 style 取 `var(--tw-outline-style)`，由 `outline-dashed` 提供）。横向留白用 `-mx-2` 不用 `-m-2`（与父 `space-y-*` 的 margin-top 撞同组）。
- 切 P 只改 `src`+`load()`，**禁用 `key={src}` 重挂载**；视频分P 控件在画面浮层；`av-embed.tsx` 只服务多 P 视频；字幕唯一来源 `lib/captions.ts`（`meta.ts → captions.ts` 单向），文本**内联**在 meta；自绘不用 `<track>`；音频歌词板**滚动手算 `scrollTop`、禁 `scrollIntoView`**；按钮原语 `av-btn.tsx`；`parseMeta` 降级链：整块 → 丢 captions → 再丢 tracks → 兜底。
