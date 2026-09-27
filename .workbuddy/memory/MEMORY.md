# PixelHub 项目长期约定

## 验证
- 只跑 `npx tsc --noEmit` + `npx eslint`；不写 jsdom/SSR 探针、不做「反证」。改 Tailwind class 时另用 postcss 实编 `globals.css` 确认类真产出；v4 产物已美化（group → `:is(:where(.group):hover *)`，`divide-y-2` → `:where(.divide-y-2 > :not(:last-child))`），别按老形态匹配。
- 探针放 `prisma/_*`、用完立即删（环境会自动 commit）。**不要整文件 `prettier --write`**（多数文件不符 `.prettierrc`），只格式化新增文件。DB 是远端 Supabase，偶发连不上，重跑即可。

## 迁移顺序（2026-09-27 事故）
- **破坏性迁移必须与代码分两批**：先上线不含该引用的代码、确认线上是新镜像，再 DROP。实例：`0018_drop_resource_version.sql` 后旧镜像 JOIN `ResourceVersion` → 详情页全挂（止血＝按原 schema 建回空表，别往 `prisma/migrations/` 加自相矛盾的回滚）。
- 线上是外部主机的容器（本机无 docker、无 compose，只有 `Dockerfile`）→ 改完必须提醒用户重建镜像，我无法从本机部署。

## UI 语言
- 像素风 + Fusion Pixel + 点阵背景 + 赤陶橙 brand + 全站 `rounded-none`。类型图标唯一来源 `resource/type-icon.tsx`。
- 暗色只覆盖部分阶：brand 50–900 全；neutral 50/100 在 `html.dark` 里重定义过（**暗色安全**）、200–950 在 @theme 改写；red 50/100/200/300/600/700；amber 100/200/300/600/700/900。emerald/sky 完全没覆盖，只能在固定深底上用。
- 分隔线统一原生 dashed、brand-300、2px：`border-t-2 border-dashed border-brand-300`（区块横线/评论区分隔线/UserHoverCard）、`border-b-2 …`（DetailTwocol 标题）、`divide-y-2 divide-dashed divide-brand-300`（下载清单/分P 列表）。`.md-body hr` 与 `.ProseMirror hr` = `border:0` + `border-top:2px dashed`。点划线那套（`--rule-dot*`）已删，别加回来。
- 「评论框」= `rte/MdEditor.tsx` 根 div（`border-2 border-dashed border-brand-300`），`MdEditorLazy.tsx` 占位必须同款；它被评论框与资源编辑器共用。后台 `admin/*` 与登录页的 `border-brand-200` 是另一套口径，别一起改。

## 主页背景（双槽）
- `profileBgPcKey`/`profileBgMobileKey` 各配遮罩；`profileBgOnResource`/`profileBgGlobal`/`bgMinLevel` 两槽共用，**不跨槽回落**。遮罩类唯一来源 `globals.css` 的 `.profile-bg-pc`/`.profile-bg-mobile`。
- **`safeBgMask(raw, slot)` 的 slot 不能省**；返回值内联传 `--profile-bg-mask`，压过类默认值 → 传错槽位不报错、只静默套错形状。owner 压 global 要按断点成对写（`:has()` 不看 display）：`-pc`/`-mobile` + `min-width:40rem`/`width<40rem` 两个媒体查询。
- `profileBgGlobal` 是**自见**开关；`profileBgOnResource` 是唯一让访客背景让位的开关（作者本人不受约束，靠 `isOwnResourcePage`）；别人的个人主页 `GlobalProfileBg` 显式 `return null`。别再问。

## 置顶 / 精华 / 权限
- 仅 `adminOnly`：`pinnedAt`/`featuredAt`（null = 未标记、故意不加索引）。`staff` = 审核/打回/下架/举报/`setResourceFlags`。
- 置顶是 `getFeed` 第一排序键 `pinnedAt DESC NULLS LAST`（`nulls:"last"` 必写，PG 的 DESC 默认 NULLS FIRST）；`pinFirst` 只在按内容打分处关掉（`getRelated` 候选池、`popularFallback`）。
- keyset 游标必须与 orderBy 同构（`FeedCursor.p` + `cursorAfter` 的置顶层/secondaryAfter）；改排序键两处一起改，否则翻页重复/漏行/空白且不报错。
- 角标四处：`ResourceCard`、`ResourceRow`、`detail/parts.tsx` 的 `DetailMarks`（四模板共用，banner 传 `tone="dark"`）。
- 精华发 FEATURED 积分（`awardPoints` 的 `(userId,reason,refId)` 唯一索引去重；管理员自点被 `NO_SELF_BENEFIT` 拦）。「加入专题」= `actions/home.ts` 的 `addResourceToFeaturedSectionAction`，追加进**第一个** featured 板块（上限 24），没有就报错。
- 可见性开关文案唯一来源 `upload/wizard-shared.tsx` 的 `PUBLISH_OPTIONS`。后台写布尔开关逐字段显式取值，不要 spread。

## Prisma 事务铁律
- 事务内**不许 `create().catch()` 兜唯一键冲突**：PG 一条语句报错即整事务 aborted，之后每条 25P02，与 JS 层 catch 无关，真根因被 `PrismaClientUnknownRequestError` 盖掉。用 `createMany({ skipDuplicates: true })` 靠 `count` 判断（参考 `_tags.ts`）。find-or-create 必须按**所有**唯一键查；关联表按解析出的 id 去重。
- 标签同一性：**slug 相同就是同一个标签**，直接合并（`/tags/{slug}` 是公开 URL）。`findOrCreateTag` 命中链 name → slug → create。

## Markdown
- `react-markdown` 基线 CommonMark，表格靠 `remark-gfm`（整体开关，顺带开删除线/任务列表/裸链/脚注）。`rte/Markdown.tsx` 的 `gfm?` 默认 false，**只资源正文**（`DescriptionBlock`）开；评论关（`Comments.tsx` 的 `COMMENT_FEATURES` 也关表格，两边成对）。脚注标题带 `sr-only`，仓库没这个工具类，要在 `.md-body` 自己写。
- 颜色 token 都在 `:root`、引用品牌阶、**无 dark 覆盖**：`--md-code-bg`=brand-200 只给行内 code；`--md-code-block-bg`=brand-100 + `--md-block-border`=brand-300 给有边框的块（`pre`/编辑器、`th` 底、`th/td` 格线）。`--md-rule` 已删，`--md-border` 只剩 blockquote 描边与编辑器。别改回中性灰。

## 音视频（2026-09-27 重构）
- **`source`(mount/file) 已删**，站内/外链看 URL 是否以 `/` 开头。**音频没有嵌入页**：`parseMeta` 把 MUSIC 恒钉 `mode:"direct"`；VIDEO 保留 embed。形态自动推断 `suggestMode(url,kind)`；表单只有一个输入框（可手填/旁挂上传按钮回填）。
- **字幕/歌词与播放项一一对应**：`meta.caption`（主来源）+ `tracks[].caption`，无 `label`、无 `captions[]`。上限 `AV_CAPTION_TEXT_MAX` 160K / 总量 `AV_CAPTION_TOTAL_MAX`。读取层兼容旧 `captions[]`（取 `[0]`）；迁移脚本 `prisma/migrate-av-caption.ts`（默认 dry-run，`--apply` 才写）。
- 表单契约：主来源 `avUrl`/`avTitle` + 隐藏 `avCaption`；其余行走隐藏 `avTracks`(JSON，含每行 caption) + 隐藏 `avMode`。行编辑器 `upload/av-row.tsx`；字幕字段 `upload/caption-section.tsx` = 受控单项 `CaptionField`（**宿主持值**，自持 state 会在行增删时错位）。小控件另写独立类，别拼 `wizInput`/`wizBtn`（同组属性冲突，产物顺序不保证）。
- `meta.tracks` 不含主来源那一 P；拼装唯一入口 `lib/av-tracks.ts` 的 `avPlaylist()` = `[主来源, ...tracks]`，主来源 = P1。切 P 只改 `src` + `load()`，**不要 `key={src}` 重挂载**（会重置倍速/音量/展开态）。视频分P 控件在画面浮层（不进控件行，320px 排满）；`av-embed.tsx` 只服务多 P 视频（`isAudio` 已删），单 P 由 `av-player.tsx` 直出 iframe。
- 字幕：`lib/captions.ts` 唯一事实来源，依赖单向 `meta.ts → captions.ts`。文本**内联**在 meta（`/od/…` 302 到无 CORS 的预鉴权链接，客户端必失败）；支持 vtt/srt/lrc/ass/txt；时间戳按小数位数定标、cue 的 end 只收紧不拉长。自绘不用 `<track>`；视频 = 画面底部叠层（`bottom-14`+`pointer-events-none`），音频 = 卡片内歌词板，**滚动手算 `scrollTop`、禁 `scrollIntoView`**（会滚整页）。按钮原语 `av-btn.tsx`，带文本按钮用 `AV_BTN_HEIGHT`。
- `parseMeta` 降级链：整块 → 丢 captions → 再丢 tracks → 兜底。草稿 `avTitle`/`avCaption`/`avTracks`（后两者上限 1.2M）；`draftPayloadSchema` 一失败整条草稿回落成空。
- **AV meta 里 `license`/`note` 不在 `avMetaSchema`**（zod strip）：写进去等于没写，AV 没有授权/说明。`seed-av-demo.ts` 的 meta 已是 `z.input<typeof avMetaSchema>`，多写/写错键 tsc 会拦。

## 打赏
- 唯一入口 = 资源详情页 `ActionBar`（`detail/parts.tsx`），作品维度（`TipRecord.resourceId`）。个人主页「直接打赏作者」/`TipUserButton`/`sendUserTipAction` 已删。未登录/作者本人/开关关闭不出入口（`tipFormOf` 返回 undefined）。
