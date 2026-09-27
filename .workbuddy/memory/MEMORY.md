# PixelHub 项目长期约定

## 验证口径（用户明确要求，2026-09-27）

- UI / 业务改动**只跑 `tsc --noEmit` + `eslint`**，不要写 jsdom / SSR 探针，也**不要做「反证」**
  （把源码临时改回旧实现跑一遍看断言变红）那套流程。用户原话：「不要做正反验证了 只需要eslint和tsc」。
- 例外：改了 Tailwind class 时，用 postcss 编一次 `globals.css` 确认类真的产出（否则样式静默丢失，
  看源码毫无破绽）。Tailwind v4 的产物是**美化过的**，且 group 变体编译成
  `:is(:where(.group):hover *)` 形式——按 `.group:hover .child` 去匹配会假失败。
- 探针文件一律放 `prisma/_*`，用完立即删（环境会自动 commit，脏文件会被带进仓库）。
- **不要对整文件跑 `prettier --write`**：本仓库有大量文件并不符合仓库 `.prettierrc`（导入折行、
  单行三元、长 JSX 属性），整文件格式化会把几十行无关改动混进交付 diff。只格式化**本次新增的文件**；
  改多行的要用小范围补丁（Edit）。
- 探针要 import 源码时 `@/` 别名在 tsx 下可用，但只用相对路径最稳（`../src/lib/xxx`）。
  数据库是**远端 Supabase**，偶发连不上（`Can't reach database server`），重跑一次即可。

## 数据库迁移顺序（2026-09-27 事故后定规）

- **破坏性迁移（DROP TABLE / DROP COLUMN）必须与代码拆成两个发布批次**：先让不含该引用的代码上线，
  确认线上跑的是新镜像，再执行 DROP。把两步压进同一个提交 = 假定线上会立刻重建镜像，
  一旦没重建就是「旧镜像 + 新库」，直接 500。
  - 实例：`0018_drop_resource_version.sql` 删表后，仍跑 `c2f422c` 之前镜像的容器在
    `getResourceDetail` 的 `prisma.resource.findFirst()` 里 JOIN `ResourceVersion` →
    资源详情页全挂。止血办法是把**空表按原 schema 建回去**（放 `$TEMP` 执行，
    不要往 `prisma/migrations/` 里加与迁移自相矛盾的回滚文件）。
- 部署形态：**线上是外部主机上的容器**（本机无 docker，仓库内无 compose，只有 `Dockerfile`）。
  改完代码后要提醒用户重建镜像；我无法从本机触发部署。

## UI 语言

- 像素风 + Fusion Pixel + 点阵背景 + 赤陶橙 brand + 全站 `rounded-none`。
- 暗色主题只覆盖 brand / neutral / red / amber 四组语义阶，**且这四组也不是每个阶都覆盖**：
  `brand` 50–900 齐全；`neutral` 只有 200–950（**缺 50 / 100**）；`red` 只有 50/100/200/300/600/700
  （缺 400/500/800/900）；`amber` 只有 100/200/300/600/700/900（缺 50/400/500/800）。
  所以 `bg-neutral-100` 这类写法在暗色下仍是亮底 —— `admin/content` 的 DRAFT 徽章就是这么写的（存量）。
  新建组件的底色 / 文字色请只取上列已覆盖的阶；emerald / sky 完全没有覆盖，
  在会跟随明暗的 surface 上当正文色用会糊（卡片封面那种固定深底才可以用亮阶）。
- 类型图标唯一事实来源：`src/components/resource/type-icon.tsx`（TYPE_ICON / TYPE_BADGE_TONE / TypeIcon）。

## 主页背景是「双槽」结构（2026-09-27 起）

- 桌面端 `User.profileBgPcKey` / 移动端 `User.profileBgMobileKey`，**各配一份遮罩**
  （`profileBgMask` / `profileBgMobileMask`）；`profileBgOnResource`、`profileBgGlobal`、
  等级门槛 `profile.bgMinLevel` **两槽共用**（语义：两张背景作为一个整体对外可见 / 不可见）。
- 两槽**不做跨槽回落**：只设了桌面端时移动端就是素底，不拿横图去填竖屏。
- 遮罩类唯一事实来源：`globals.css` 的 `.profile-bg-pc`（左右两条带，中段 alpha 0）/
  `.profile-bg-mobile`（**整张均匀半透明 alpha 0.5，不分区域**）；显示切换靠 Tailwind
  `hidden sm:block` / `sm:hidden`。
- **遮罩默认值分槽，取默认值必须先问槽位**：`safeBgMask(raw, slot)` 的 `slot` 不能省
  （`PROFILE_BG_MASK_DEFAULTS` 是唯一映射）。返回值是**内联** `--profile-bg-mask` 传下去的，
  内联优先级高于 `.profile-bg-*` 类自带的那份默认值 —— 传错槽位不会报错，只是静默套上另一端
  形状（本次事故：移动端永远显示桌面端左右两条带）。`isValidBgMask` 只管形状、不掺默认值，
  填的恰好是另一端形状也算合法。
- 设置页 `ProfileBgForm.tsx` 里 `BgSlotForm` 是两槽共用的槽组件；两槽的字段名映射收在
  `lib/actions/settings.ts` 的 `bgKeyData` / `bgMaskData` / `bgKeyOf`（Prisma update 是强类型的，
  不能拼动态键名）。
- **owner 压 global 的规则必须按断点成对写**：`:has()` 只看元素在不在 DOM 里、不看 display，
  一条不分断点的 `body:has([data-profile-bg-owner]) [data-profile-bg-global]` 会让
  「只设了桌面端」的用户在移动端把自己的全局背景也隐掉。现为 `-pc` / `-mobile` 两组属性 +
  两个互补媒体查询（`min-width: 40rem` 与 `width < 40rem`）。
- **可见性口径（2026-09-27 用户确认，别再反复问）**：
  - `profileBgGlobal`（全局显示）是**自见**开关 —— 只让登录者自己在更多页面看到自己的背景，
    **不会**把谁的背景推给别人。`GlobalProfileBgLoader` 取的就是 session 那个 user。
  - `profileBgOnResource`（资源页对他人可见）是**唯一**能让访客的背景让位的开关：
    开着 → 任何人进这个资源页只看到作者的背景，访客自己的全局层被 `:has()` 隐掉；
    没开 / 作者没图 / 未达等级 → 访客自己的全局背景照常铺（这就是它的兜底语义）。
  - 作者本人看自己的页面**不受该开关约束**：资源页靠 `isOwnResourcePage`（`meId === authorId`），
    个人主页无条件铺。开关只约束别人。
  - 别人的个人主页是唯一的例外：`GlobalProfileBg` 显式 `return null`，不做兜底。

## 资源运营标记：置顶 / 精华（2026-09-27 起）

- **仅管理员**可设（用 `adminOnly` 而不是 `staff`）。字段 `Resource.pinnedAt` / `featuredAt`
  （`DateTime?`，null = 未标记）；**故意不加索引**，理由写在 schema 注释里。
- **置顶是 `getFeed` 的第一排序键**：`pinnedAt DESC NULLS LAST`，latest / popular / downloads
  三种 sort 都吃这一层。`nulls: "last"` 必须显式写 —— Postgres 的 DESC 默认 NULLS FIRST，
  漏掉会把绝大多数未置顶的行排到前面，置顶反而沉底。
- **keyset 游标必须与 orderBy 同构**：`FeedCursor` 多了 `p`（pinnedAt 毫秒），`cursorAfter`
  拆成「置顶层 + `secondaryAfter`（原逻辑）」。以后改任何排序键，这两处要一起改，
  否则症状是「翻页重复 / 漏行 / 直接空白」，且不报错。
- `FeedParams.pinFirst`（默认 true）只在**按内容打分**的位置关掉：`getRelated` 的三个候选池、
  `popularFallback`。置顶插进候选池首位会盖掉相关性。
- 首页挑选位（hero / featured 块）用 `ids` 拉回后**按挑选顺序重排**，不受置顶影响。
- 前台展示收在四处，改配色别漏：卡片角标 `ResourceCard`（封面深底 → 亮阶）、列表行卡
  `ResourceRow`（浅底 → 语义阶）、详情页 `detail/parts.tsx` 的 `DetailMarks`（四个模板共用，
  banner 传 `tone="dark"`）。
- 「精华」连带发 FEATURED 积分：去重靠 `awardPoints` 的 `(userId, reason, refId)` 唯一索引，
  取消再设不会重发；管理员给自己资源点精华会被 `NO_SELF_BENEFIT` 拦（既有口径）。
- 「加入专题」= `actions/home.ts` 的 `addResourceToFeaturedSectionAction`：追加进**第一个**
  `featured` 板块的 `featuredIds`（上限 24，与 `home-config.ts` 的 `featuredCfg` 同步）；
  没有 featured 板块时明确报错，不偷偷塞进 hero。

## 后台权限口径：staff vs adminOnly

- **`staff`（版主 + 管理员）= 内容治理日常**：审核通过 / 打回、下架 / 恢复、举报处理，
  以及**审核队列里就地修正可见性标注**（`setResourceFlags`：nsfw / loginRequired / allowComments）。
- **`adminOnly` = 站点级干预**：置顶 / 精华（会改变全站排序）、用户角色 / 封禁 / 免审。
- 三个可见性开关的 **UI 文案事实来源是 `src/components/upload/wizard-shared.tsx` 的
  `PUBLISH_OPTIONS`**，审核面板 `components/admin/ResourceFlagsForm.tsx` 直接复用它，
  不要另写一份（`moderation.ts` 里那份 `FLAG_LABEL` 只服务审计日志的人话描述，不算第二来源）。
- 后台写布尔开关一律**逐字段显式取值**，不要 spread 传入对象 —— server action 的入参是
  不可信输入，多带一个键就会被一并写进库。

## Prisma 事务铁律：事务内不许用 `create().catch()` 兜唯一键冲突（2026-09-27 事故）

- Postgres 的交互式事务是「一条语句报错 → 整个事务立刻 aborted」，**之后每条语句都返回
  25P02（commands ignored until end of transaction block），与 JS 层有没有 catch 无关**。
  所以在 `prisma.$transaction(async (tx) => ...)` 里写 `tx.x.create(...).catch(() => null)`
  不是「容错」，是**把事务尸体留着继续用**：错误点在 A，报错点却在之后的 B，
  `PrismaClientUnknownRequestError` 会把真正的根因盖掉，排查方向直接跑偏。
- 需要「冲突就跳过」时用 **`createMany({ data: [...], skipDuplicates: true })`**
  （PG 落成 `ON CONFLICT DO NOTHING`，冲突不报错也不中断事务），靠返回的 `count` 判断是否真插入，
  必要再回查一次拿目标行。参考实现：`src/lib/actions/_tags.ts` 的 `findOrCreateTag` / `linkTag`。
- 「find-or-create」必须**按所有唯一键查**，不能只查一个：Tag 的 `name` 与 `slug` 都是唯一键，
  只查 name 会漏掉 slug 撞车（用户同时填「云」和「yun」→ 拼音 slug 都是 yun）。
- 同理，关联表（`TagOnResource`，复合主键）写之前要按**解析出来的 id** 去重，
  而不是按用户输入的名字去重 —— 两个不同的名字可能指向同一行。

## 标签的同一性口径：slug 相同就是同一个标签（2026-09-27 用户明确）

- **名字不同、但翻译/拼音出来的 slug 相同 → 直接合并**，不报错、不建第二个词条。
  理由：`/tags/{slug}` 是公开 URL，slug 撞车在 URL 维度就是同一个标签
  （例：「中国」与「中华」都译成 `china`）。
- 写入侧落点：`src/lib/actions/_tags.ts` 的 `findOrCreateTag` —— 命中链 **name → slug → create**，
  name 优先（作者手填的名字能对上就按名字），对不上再按 slug 归并。
- 管理后台 `renameTagAction`（`lib/actions/taxonomy.ts`）：**不再因 slug 撞车报错**，
  统一判断合并目标 —— name 变了且被占用 → 目标；否则 nextSlug 撞上既存标签 → 目标；
  命中走 `mergeTagInto()`（转挂关联 + count 净增 + 删源 + audit），未命中才 `update`。

## Markdown 渲染：CommonMark 基线，GFM 只给资源正文（2026-09-27 起）

- 解析器是 **`react-markdown`**，基线 CommonMark，**表格属 GFM 扩展、需 `remark-gfm`**。
  `.md-body table / th / td` 那套排版一直在 `globals.css` 里，但插件没装 → 样式从未被任何元素
  命中，表格语法被当普通段落显示成一行 `| a | b |`。
- `rte/Markdown.tsx` 有 `gfm?: boolean`（**默认 false**）。**只有资源正文**
  （`resource/detail/parts.tsx` 的 `DescriptionBlock`）开；评论**不开** —— 编辑器那头
  `Comments.tsx` 的 `COMMENT_FEATURES` 也关了表格，两边必须成对。
- 资源编辑器 `MdEditor`（Milkdown Crepe）的 `defaultFeatures` 里 **`table: true`**，
  作者本来就能插表格（查法：`node_modules/@milkdown/crepe/lib/esm/index.js`）。
- remark-gfm 是**整体开关、挑不出单独表格**，顺带开删除线 / 任务列表 / 裸链 / 脚注，
  这些都在 `.md-body` 里补了样式。尤其脚注：解析器给标题加 `sr-only` 类，而本仓库没有这个
  工具类（Tailwind 也不会生成，源码里根本没这个字符串），必须自己写 —— 否则正文尾部会多出
  一行 "Footnotes"。
- 要核对 GFM 产出的真实 class 名（`contains-task-list` / `task-list-item` / `dataFootnotes`），
  用 node 拼 `unified + remark-parse + remark-gfm + remark-rehype` 打印 hast 树即可：
  离线、不用起服务、不落探针文件（`rehype-stringify` 没装，用 `.run(parse(md))` 拿树）。
- **正文分隔线 / 表格格线的颜色是 `--md-rule`**（= `--brand-400`，亮暗自动跟随，同 `--md-marker`
  的写法，不需要 dark 覆盖），**不是** `--md-border`（走 `--md-border` 的只剩 `blockquote`
  的容器描边与编辑器）。分隔线是**点划线**：`border: 0` + `height: 1px` +
  `repeating-linear-gradient` 画 `6px 划 / 3px 空 / 1px 点 / 3px 空`（CSS 没有 dot-dash 的
  border-style）；表格格线是 `1px solid var(--md-rule)`，不用点划。
- **代码（行内 code / pre / 表头）走 `--md-code-bg`（= `--brand-200`）与 `--md-code-fg`
  （= `--brand-900`）**，两个都引用品牌阶、亮暗自动跟随，**没有 dark 覆盖**。
  **别再改回中性灰**：`--md-text-lg`(#27272a) 是冷灰黑，压在暖底上发闷；`--md-border`(#e5e5e5)
  对页面底只有 1.06:1。挑「浅底」档位前先算对比度 —— `brand-100` 只有 1.10:1，比老值还糊。

## 音视频分P / 曲目

- 数据：`meta.tracks`（`{title,url,duration?}`，≤ `AV_TRACKS_MAX` 60）**不含主来源那一 P**；
  主来源仍是顶层 `url/duration`。存量数据零迁移。
- **播放列表唯一拼装点 = `src/lib/av-tracks.ts` 的 `avPlaylist()`**（= `[主来源, ...tracks]`）。
  编号口径：主来源 = P1；**只有分P 时 `tracks[0]` 才是 P1** —— 向导的行号、
  播放器的列表序号都按这个来，别在别处再写一份拼装逻辑。
- 文件分工：`detail/av-controls.tsx`（播放器本体）、`av-bar.tsx`（直角滑块）、
  `av-playlist.tsx`（上一/下一按钮、列表开关、列表本体）、`av-embed.tsx`（**多 P** 嵌入页；
  单 P 嵌入页由 `av-player` 服务端直出 iframe）、`lib/av-tracks.ts`（纯逻辑 + 标签文案）。
- **切 P 只改 `src` + `load()`，不要用 `key={src}` 重挂载元素** —— 重挂载会把倍速、音量、
  列表展开态一起重置。
- **视频的分P 控件压在画面浮层上**（左侧上一集 / 右侧下一集 / 右上角列表），**不进控件行**：
  320px 下控件行已经排满，再加三个 36px 按钮必横向溢出。音频放得下 → 留在控件行 + 卡片内列表。
- 分P 只支持填地址；上传与自动抓取时长/封面只对主来源做。草稿字段 `avTracks`（JSON 原文）。
- `parseMeta` 的音视频分支在整块 parse 失败后会**丢掉 tracks 再试一次**：tracks 是附加信息，
  一条脏分P 不该把已落库的 `url` 一起拖进 `AV_META_FALLBACK`。

