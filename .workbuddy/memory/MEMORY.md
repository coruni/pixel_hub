# PixelHub 项目长期约定

## 验证口径（用户明确，2026-09-27）
- 只跑 `npx tsc --noEmit` + `npm run lint`；不写 jsdom/SSR 探针，不做「反证」。原话：「不要做正反验证了 只需要eslint和tsc」。
- 例外：改 Tailwind class 时用 postcss 编一次 `globals.css` 确认类真产出（静默丢失时看源码无破绽）。v4 产物是美化过的，group 变体是 `:is(:where(.group):hover *)`。
- 探针一律放 `prisma/_*` 且用完立即删（环境会自动 commit）。**不要整文件跑 `prettier --write`**（大量文件不符 `.prettierrc`，会混进几十行无关 diff），只格式化本次新增文件。
- DB 是远端 Supabase，偶发 `Can't reach database server`，重跑即可。

## 数据库迁移顺序（2026-09-27 事故）
- **破坏性迁移（DROP TABLE/COLUMN）与代码分两个发布批次**：先上线不含该引用的代码，确认线上跑新镜像，再 DROP。实例：`0018_drop_resource_version.sql` 后旧镜像 JOIN `ResourceVersion` → 资源详情页全挂；止血是把空表按原 schema 建回（不要往 `prisma/migrations/` 加自相矛盾的回滚）。
- 线上是外部主机上的容器（本机无 docker、仓库无 compose，只有 `Dockerfile`）。改完要提醒用户重建镜像，我无法从本机部署。

## UI 语言与暗色主题
- 像素风 + Fusion Pixel + 点阵背景 + 赤陶橙 brand + 全站 `rounded-none`。
- 暗色只覆盖 brand/neutral/red/amber 且不齐：brand 50–900 全；`neutral` 在 `html.dark` 里显式重定义了 50 (#1c1814) / 100 (#252019) / 900，另有 @theme 直接改写的 200–950，所以 **neutral-50/100 是暗色安全的**（曾误记为「缺 50/100」，2026-09-27 用 postcss 实编核对推翻）；red 仅 50/100/200/300/600/700；amber 仅 100/200/300/600/700/900。`bg-neutral-100` 这类写法实测会跟随暗色。emerald/sky 完全没覆盖，只在固定深底上可用。
- 类型图标唯一来源：`src/components/resource/type-icon.tsx`（TYPE_ICON / TYPE_BADGE_TONE / TypeIcon）。

## 主页背景：双槽结构
- `profileBgPcKey` / `profileBgMobileKey` 各配遮罩 `profileBgMask` / `profileBgMobileMask`；`profileBgOnResource` / `profileBgGlobal` / `profile.bgMinLevel` 两槽共用。**不做跨槽回落**（只设桌面端则移动端素底）。
- 遮罩类唯一来源 `globals.css` 的 `.profile-bg-pc` / `.profile-bg-mobile`；切换靠 `hidden sm:block` / `sm:hidden`。
- **`safeBgMask(raw, slot)` 的 slot 不能省**（`PROFILE_BG_MASK_DEFAULTS` 唯一映射）。返回值内联传 `--profile-bg-mask`，压过类自带默认值 —— 传错槽位不报错，只静默套另一端形状。`isValidBgMask` 只管形状、不掺默认值。
- `ProfileBgForm.tsx` 的 `BgSlotForm` 两槽共用；字段映射收在 `lib/actions/settings.ts` 的 `bgKeyData` / `bgMaskData` / `bgKeyOf`（Prisma update 强类型，不能拼动态键名）。
- owner 压 global 必须按断点成对写（`:has()` 不看 display）：`-pc` / `-mobile` 两组属性 + `min-width: 40rem` 与 `width < 40rem` 两个媒体查询。
- 可见性口径（已确认，别再问）：`profileBgGlobal` 是**自见**开关，不推给别人；`profileBgOnResource` 是唯一让访客背景让位的开关（作者本人不受约束，靠 `isOwnResourcePage`）；别人的个人主页 `GlobalProfileBg` 显式 `return null` 不兜底。

## 资源运营标记：置顶 / 精华
- 仅 `adminOnly`。`Resource.pinnedAt` / `featuredAt`（null = 未标记），**故意不加索引**（理由在 schema 注释）。
- 置顶是 `getFeed` 第一排序键 `pinnedAt DESC NULLS LAST`，三种 sort 都吃；`nulls:"last"` 必须显式写。
- keyset 游标必须与 orderBy 同构：`FeedCursor.p` + `cursorAfter` 的「置顶层 + secondaryAfter」。改排序键两处一起改，否则翻页重复/漏行/空白且不报错。
- `pinFirst`（默认 true）只在按内容打分处关掉：`getRelated` 三个候选池、`popularFallback`。首页 hero/featured 用 `ids` 拉回后按挑选顺序重排。
- 前台展示四处：`ResourceCard` 角标（深底→亮阶）、`ResourceRow`（浅底→语义阶）、`detail/parts.tsx` 的 `DetailMarks`（四模板共用，banner 传 `tone="dark"`）。
- 精华连带发 FEATURED 积分（去重靠 `awardPoints` 的 `(userId,reason,refId)` 唯一索引；管理员自点被 `NO_SELF_BENEFIT` 拦）。「加入专题」= `actions/home.ts` 的 `addResourceToFeaturedSectionAction`：追加进**第一个** featured 板块（上限 24，同 `home-config.ts` 的 `featuredCfg`）；没有 featured 板块就报错，不塞 hero。

## 后台权限：staff vs adminOnly
- `staff` = 内容治理日常：审核/打回、下架/恢复、举报，以及审核队列就地改可见性（`setResourceFlags`）。
- `adminOnly` = 站点级干预：置顶/精华、用户角色/封禁/免审。
- 三个可见性开关的 UI 文案唯一来源 `upload/wizard-shared.tsx` 的 `PUBLISH_OPTIONS`（`ResourceFlagsForm` 直接复用；`moderation.ts` 的 `FLAG_LABEL` 只服务审计日志）。后台写布尔开关逐字段显式取值，不要 spread。

## Prisma 事务铁律：不许用 `create().catch()` 兜唯一键冲突
- PG 交互式事务一条语句报错 → 整事务 aborted，后续每条都 25P02，与 JS 层 catch 无关。`.catch(()=>null)` 不是容错，是留着事务尸体继续用，真根因被 `PrismaClientUnknownRequestError` 盖掉。
- 「冲突就跳过」用 `createMany({ data, skipDuplicates: true })`（ON CONFLICT DO NOTHING），靠 `count` 判断，必要时回查。参考 `lib/actions/_tags.ts` 的 `findOrCreateTag` / `linkTag`。
- find-or-create 必须按**所有**唯一键查（Tag 的 name 与 slug 都是唯一键）。关联表（`TagOnResource` 复合主键）按解析出的 id 去重，不按用户输入的名字。

## 标签同一性：slug 相同即同一标签
- 名字不同但 slug 相同 → 直接合并（`/tags/{slug}` 是公开 URL）。写入侧 `_tags.ts` 的 `findOrCreateTag`：命中链 name → slug → create。
- `renameTagAction`（`lib/actions/taxonomy.ts`）不因 slug 撞车报错，统一判断合并目标，命中走 `mergeTagInto()`（转挂 + count 净增 + 删源 + audit）。

## Markdown 渲染
- 解析器 `react-markdown`，基线 CommonMark，表格靠 `remark-gfm`。`rte/Markdown.tsx` 的 `gfm?` 默认 false，**只有资源正文**（`resource/detail/parts.tsx` 的 `DescriptionBlock`）开；评论不开（编辑器 `Comments.tsx` 的 `COMMENT_FEATURES` 同样关表格，两边成对）。
- 资源编辑器 `MdEditor`（Milkdown Crepe）`defaultFeatures` 里 `table: true`。remark-gfm 是整体开关，顺带开删除线/任务列表/裸链/脚注；脚注标题带 `sr-only` 类，本仓库没有该工具类，必须在 `.md-body` 里自己写。
- 核对 GFM 真实 class（`contains-task-list` / `task-list-item` / `dataFootnotes`）：node 拼 `unified + remark-parse + remark-gfm + remark-rehype`，用 `.run(parse(md))` 打印 hast 树。离线、不落探针。
- 颜色 token（都在 `:root`，引用品牌阶自动跟随明暗，无 dark 覆盖）：`--md-code-bg` = brand-200 **只给行内 code**（无边框，靠底色辨认，别降到 100 阶）；`--md-code-block-bg` = brand-100 与 `--md-block-border` = brand-300 **给有边框的块**（`pre` 及其编辑器对应规则、`th` 底色、`th/td` 格线）。旧的 `--md-rule` 已删除。`--md-border` 现在只剩 blockquote 描边与编辑器。
- **「评论框」= `src/components/rte/MdEditor.tsx` 根 div**（不在 `Comments.tsx` 里）：现为 `border-2 border-dashed border-brand-300`；`MdEditorLazy.tsx` 的 loading 占位必须同款，否则懒加载前后框会跳一下。`globals.css` 里 `.md-editor .milkdown` 的 `--crepe-color-outline` 是 brand-300（它管 Crepe 表格格线，必须与前台同档，否则所见即所得破功）。`MdEditor` 被评论框与资源编辑器共用 —— 改它等于同时改两处。**后台 `admin/*` 与登录页的 `border-brand-200` 是另一套「容器描边」口径，不要顺手一起改。**
- 分隔线统一走 **CSS 原生 dashed**，颜色 brand-300、粗细 2px，**没有自定义 @utility**：`border-t-2 border-dashed border-brand-300`（各区块横线 / 评论区分隔线 / UserHoverCard）、`border-b-2 …`（DetailTwocol 标题区）、`divide-y-2 divide-dashed divide-brand-300`（下载清单 / 分P 列表行间线）。`.md-body hr` 与编辑器 `.ProseMirror hr` 都是 `border: 0` + `border-top: 2px dashed` + `height: 0`。**历史**：曾用「背景色带 + 透明占位边框」做**点划线**（`--rule-dot` / `--rule-dot-v` / `--rule-dot-w` + `rule-dot-t/-b/-rows/-box`），因为 border-style 做不出 dot-dash；用户 2026-09-27 改要纯虚线后已**整体删除**（那套还有「覆盖 background-image、调用点不能叠渐变类」的副作用）。别加回来。
- **Tailwind v4 的 divide-\* 产物形态**：`:where(.divide-y-2 > :not(:last-child)) { … }` —— `:where` 在**外层**、结尾**两个**右括号，按 `.divide-y-2 {` 匹配会假失败。`divide-dashed` 只写 `--tw-border-style: dashed`，宽度类（`divide-y-2`）写 `border-*-style: var(--tw-border-style)`；两条命中同一批子元素，变量按元素级联求值，**产物顺序不影响**结果。
- **别再改回中性灰**：`--md-text-lg`(#27272a) 冷灰压暖底发闷；`--md-border`(#e5e5e5) 对页面底仅 1.06:1。挑「浅底」档位前先算对比度。

## 音视频分P / 曲目
- `meta.tracks`（`{title,url,duration?}`，≤ `AV_TRACKS_MAX` 60）**不含主来源那一 P**；主来源仍是顶层 `url/duration`。
- 播放列表唯一拼装点 `lib/av-tracks.ts` 的 `avPlaylist()`（`[主来源, ...tracks]`）：主来源 = P1，**只有分P 时 `tracks[0]` 才是 P1**。
- 切 P 只改 `src` + `load()`，不要 `key={src}` 重挂载（会重置倍速/音量/列表展开态）。
- 视频分P 控件压在画面浮层（左上一集/右下下一集/右上列表），不进控件行（320px 已排满）；音频留在控件行 + 卡片内列表。
- 分P 只填地址；上传/抓时长封面只对主来源。`parseMeta` 音视频分支整块失败后丢 tracks 再试一次。

## 音视频字幕 / 歌词
- 字幕文本内联在 `meta.captions[].text`，不存地址、不走上传：`<track>` 只认 WebVTT；站内 `/od/…` 302 到不带 CORS 头的 Graph 链接必失败；文本小。上限 `AV_CAPTION_TEXT_MAX` 160K 字符、`AV_CAPTIONS_MAX` 6 条；`feedSelect` 不取 meta。
- `src/lib/captions.ts` 是唯一事实来源；依赖单向 `meta.ts → captions.ts`。
- 支持 vtt/srt/lrc/ass(ssa)/txt，不做 smi/ttml/sub+idx。时间戳按小数位数定标（1=十分秒、2=厘秒=ASS、3=毫秒）；cue 的 end 只收紧不拉长。
- 自绘不用 `<track>`：视频 = 画面底部叠层（`bottom-14` 让开控件行 + `pointer-events-none`），音频 = 卡片内滚动歌词板。**歌词板自动滚动手算 `scrollTop`，禁止 `scrollIntoView`**（会滚整页）。
- 开关落位：视频的字幕 + 分P 开关并排右上角浮层；音频进控件行。嵌入页字幕由来源站点控制。按钮原语 `detail/av-btn.tsx`，带文本按钮用 `AV_BTN_HEIGHT`（不要 `AV_BTN_SIZE` + `w-auto`）。
- `parseMeta` 三级降级：整块 → 丢 captions → 再丢 tracks → 兜底。草稿 `avCaptions` 上限 1.2M 字符（`draftPayloadSchema` 一失败整条草稿回落成空）。

## 打赏入口
- 唯一入口 = 资源详情页 `ActionBar`（`detail/parts.tsx`），作品维度：`TipRecord.resourceId` = 作品 id，收款方由服务端反查作者（`sendTipAction`）。**个人主页「直接打赏作者」入口、`TipUserButton`、`sendUserTipAction` 已整体删除**（`TipButton.tsx` 历史注释是上一版口径）。
- 不出入口：未登录 / 作者本人 / 激励或打赏开关关闭（`tipFormOf` 返回 undefined）。`ActionBar` 是 async 组件，被 post/banner/twocol/article 四模板共用。
