# PixelHub 长期约定

## 验证 / 部署
- 只跑 `tsc --noEmit` + `eslint`；不写探针、不做反证。探针放 `prisma/_*` 用完立即删（环境会自动 commit）；别整文件跑 `prettier`。DB 是远端 Supabase，偶发断连重跑即可。
- 改 Tailwind class 要用 postcss 实编 `globals.css` 确认产出；探针的类名走 `process.argv` 传（写进文件里就成了调用点，检查永远通过），变体类在产物里是 `.hover\:x:hover` 形式。
- **DROP 类破坏性迁移必须与代码分两批**：先上线不含该引用的代码、确认线上跑的是新镜像，再 DROP。线上是外部主机容器（只有 `Dockerfile`）→ 改完提醒用户重建镜像。

## UI 语言
- 像素风 + Fusion Pixel + 点阵背景 + 赤陶橙 brand + 全站 `rounded-none`；类型图标唯一来源 `resource/type-icon.tsx`；按钮走 `<Button variant size>` 两轴字典。
- 暗色只覆盖部分阶：brand 50–900 全、neutral 200–950、red 50/100/200/300/600/700、amber 100/200/300/600/700/900；emerald/sky 无覆盖。提示文字全站统一 `text-amber-600`。
- 分隔线统一 `border-*-2 border-dashed border-brand-300`（列表 `divide-y-2 divide-dashed`）。「评论框」= `rte/MdEditor.tsx` 根 div。
- **同组属性别拼**：输入框要别的尺寸就单写一份（`wizInputSm` 已随播放项行收进抽屉而删）；`${wizLabel} mb-0` 这类同样是同组并存，靠产物顺序定胜负。

## 背景层（双槽 + 简洁模式）
- 双槽：`profileBgPcKey`/`profileBgMobileKey` 各配一份遮罩，**不跨槽回落**；`profileBgOnResource`/`profileBgGlobal`/`bgMinLevel` 共用。遮罩类 `.profile-bg-pc`/`.profile-bg-mobile` 在 `globals.css`。
- **`safeBgMask(raw, slot)` 的 slot 不能省**：返回值内联传 `--profile-bg-mask` 压过类默认值，传错槽位不报错、只静默套错形状。owner 压 global 按断点成对写（`:has()` 不看 display）。
- `profileBgGlobal` 是**自见**开关；`profileBgOnResource` 是唯一能让访客背景让位的开关（作者本人不受约束）；别人的主页 `GlobalProfileBg` 显式 `return null`。
- **简洁模式**（访客降噪，一键收掉三类背景图）：偏好存 cookie（`lib/simple-mode.ts`）而非账号字段 —— 未登录访客也要能用，且服务端在 layout 读得到 → SSR 首帧即带 `<html data-simple-bg>`，零闪烁。靠 `html[data-simple-bg] [data-profile-bg-*] { display:none }` 生效，**故意不放进 layer** 才能在 sm 以上压住 Tailwind 的 `sm:block`；`GlobalProfileBgLoader` 开头短路省掉取数。两处入口可能同时挂载，切换后广播 `simple-bg-change` 让另一份重读状态。

## 权限与运营标记
- `adminOnly`：置顶/精华/角色/封禁/免审。`staff`：审核打回下架恢复、举报、`setResourceFlags`。可见性开关文案唯一来源 `wizard-shared.tsx` 的 `PUBLISH_OPTIONS`；后台写布尔开关逐字段取值，不要 spread。
- `pinnedAt`/`featuredAt`（null=未标记、不加索引）是 `getFeed` 第一排序键 `pinnedAt DESC NULLS LAST`（`nulls:"last"` 必写）；`pinFirst` 只在按内容打分处关。keyset 游标必须与 orderBy 同构（`FeedCursor.p` + `cursorAfter` 的置顶层/secondaryAfter），改排序键两处一起改，否则翻页重复/漏行/空白且不报错。
- 角标四处：`ResourceCard`/`ResourceRow`/`detail/parts.tsx` 的 `DetailMarks`（四模板共用，banner 传 `tone="dark"`）。精华发 FEATURED 积分（唯一索引去重）；「加入专题」进**第一个** featured 板块（上限 24）。

## Prisma
- 事务内**不许 `create().catch()` 兜唯一键冲突**：PG 报错即整事务 aborted（之后全 25P02），真根因被盖掉。用 `createMany({skipDuplicates:true})` 靠 `count` 判断（见 `_tags.ts`）。find-or-create 按**所有**唯一键查；关联表按解析出的 id 去重。
- **标签 slug 相同就是同一个标签**（`/tags/{slug}` 是公开 URL），直接合并；`findOrCreateTag` 命中链 name → slug → create。

## Markdown
- `react-markdown` 基线 CommonMark，表格靠 `remark-gfm`（整体开关）。`rte/Markdown.tsx` 的 `gfm?` 默认 false，**只资源正文**开、评论关。脚注标题带 `sr-only`（仓库没这个类）要自己写。
- 代码色 token 都在 `:root`、无 dark 覆盖：`--md-code-bg`=brand-200、`--md-code-block-bg`=brand-100、`--md-block-border`=brand-300；别改回中性灰。

## 音视频
- `source` 已删（站内/外链看是否以 `/` 开头）；**音频无嵌入页**（MUSIC 恒 `mode:"direct"`，VIDEO 保留 embed），形态靠 `suggestMode` 推断。`av-probe.ts` 只剩 `capturePoster`；**播放器时长由媒体元素自报，别删**。
- 字幕/歌词与播放项一一对应：`meta.caption` + `tracks[].caption`，无 `label`/`captions[]`；读取层兼容旧 `captions[]`（取 `[0]`）。表单字段：`avMode` + 主来源 `avUrl`/`avTitle`/`avCaption` + 其余行 `avTracks`(JSON)。
- **`av-row.tsx` 的行只剩「编号 · 标题 · 设置图标」**（整行仍可拖放上传）：改标题/地址/上传/字幕全在 `av-item-drawer.tsx` 的抽屉里（`open=false` 不渲染），字幕字段体是 `caption-field.tsx`（原 `caption-drawer.tsx` 已拆删）。**主来源的 `avUrl`/`avTitle` 改由 `av-section` 的隐藏字段提交** —— 抽屉关着不渲染，字段挂在行里一关抽屉就丢值。行上仍摊开三样：上传进度/结果（抽屉开着时归抽屉）、字段错误（藏着就没法定位）、有内容没地址的跳过预警（该行提交时被静默丢弃）。
- 抽屉两个坑：`fixed` 但**仍挂在 `<li>` 子树里** → `useFileDrop` 必须 `disabled: uploading || open`（否则拖 .srt 冒泡上去被当视频传）；`onClose` 必须 `useCallback` 稳定，否则 effect 重跑反复抢焦点。
- `meta.tracks` 不含主来源那一 P；拼装唯一入口 `lib/av-tracks.ts` 的 `avPlaylist()`。切 P 只改 `src`+`load()`，**禁用 `key={src}` 重挂载**；视频分P 控件在画面浮层；`av-embed.tsx` 只服务多 P 视频。
- 字幕唯一事实来源 `lib/captions.ts`（`meta.ts → captions.ts` 单向），文本**内联**在 meta（`/od/…` 302 到无 CORS 链接）。自绘不用 `<track>`；音频歌词板**滚动手算 `scrollTop`、禁 `scrollIntoView`**；按钮原语 `av-btn.tsx`。
- `parseMeta` 降级链：整块 → 丢 captions → 再丢 tracks → 兜底。标题自动填 `lib/av.ts` 的 `avTitleFromFile(name)`（只在空或等于上次自动值时写入）。
