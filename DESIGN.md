# 资源社区平台设计方案（游戏 / 图片分享 · 参考 Civitai）

> 状态：**决策已固化（D1–D8）** · 修订：2026-09-02 · v1.1
> 技术底座：Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Turbopack
> 本文件是产品 + 架构 + 数据模型的设计文档，作为后续开发的功能蓝图。

---

## 0. 决策结论表（D1–D8）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 游戏发布形态 | **仅外链/网盘起步**，平台不托管游戏大文件，无分片上传与大对象存储 |
| D2 | 图片资源定位 | **四类全支持**：AI 生成图 / 壁纸素材 / 原创画作 / 截图晒图 → meta 需含 AI 标注与原创/授权声明 |
| D3 | 登录才可下载 | **可配置**：游客可浏览；是否需登录下载按资源级开关，平台可全局强制 |
| D4 | 认证方式 | **邮箱密码(bcrypt) + GitHub OAuth**（Auth.js v5） |
| D5 | 界面适配 | **双端同等**响应式（桌面瀑布流主场景 + 移动端触屏优化） |
| D6 | 内容审核 | **白名单免审**：默认投稿进队列(PENDING)；管理员标记可信用户(`User.trusted`)直接发布 |
| D7 | 视觉基调 | **简洁画廊风**：大留白、中性底色、图片为主角（类 Civitai / ArtStation 克制风格） |
| D8 | 评论带图 | **放 V1**，MVP 评论纯文字 |

---

## 1. 产品定位

面向「游戏 / 图片 / 其他数字资源」的资源分享与社区平台，用户可以：

- **发布**资源（图片含预览图集 + 封面 + 描述 + 标签；游戏为外链/网盘直达 + 封面截图）
- **浏览 / 发现**资源（推荐、最新、热门、分类、标签、搜索）
- **社交互动**（点赞、收藏、评论、关注作者、通知）
- **二次创作**回传（图片社区氛围，V1+ 评论带图）
- **管理**（用户内容、举报审核、社区治理）

Civitai 值得借鉴的机制（逐条评估是否采用）：

| Civitai 机制 | 说明 | 决策 |
|---|---|---|
| Model + Image 分离 | Model（资源主体）+ 一组预览/成图 | ✅ `Resource` + `Media` |
| 瀑布流图库浏览 | 首页/发现以图片卡片流为主 | ✅ 图片类资源为主视觉 |
| 类型 + 分类 + 标签 + 排序 | type / category / tag / sort / 时间窗 | ✅ |
| 资源版本迭代 | 资源挂多版本文件 | ⭕ 预留 `ResourceVersion`（D1 外链下暂不用） |
| 用图回帖 / 评论 | 评论可带图 | ⭕ V1（D8） |
| 收藏夹 Collection | 用户自建合集 | ✅ V1 |
| 关注作者 + 时间线 | Follow + Home「关注」Tab | ✅ V1 |
| 审核队列 Moderation | 投稿先审，可信用户免审 | ✅ V1（D6） |
| 举报 + 封禁 | Report / Ban | ✅ V1 |
| 榜单/推荐位 | 周榜月榜、编辑推荐 | ⭕ V2 |
| 站点货币/会员/Bounty | 交易与任务体系 | ❌ 不在范围 |

---

## 2. 用户角色与权限

| 角色 | 权限要点 |
|---|---|
| 访客 (Guest) | 浏览公开内容、查看作者主页；不可下载 `loginRequired` 资源、不可互动 |
| 用户 (User) | 登录后：发布资源、点赞/收藏/评论/关注、管理自己内容、个人主页与设置 |
| 可信创作者 (User.trusted) | 投稿**免审直发**（D6 白名单），仍受事后治理约束 |
| 审核员 (Moderator) | 审核队列、举报处理、违规下架、警告/短期封禁 |
| 管理员 (Admin) | 全部权限：用户/角色/trusted 标记、分类与标签治理、封禁解封、全局设置 |

> `User.role` 枚举表达角色；「可信免审」用 `User.trusted: Boolean` 表达，与角色正交。

---

## 3. 内容模型（信息架构核心）

### 3.1 统一抽象：Resource（资源帖）

> 所有可发布内容统一为 `Resource`，用 `type` 区分；社交/审核/通知/搜索全部复用一套。

**type 字典**（可扩展）：
- `GAME` 游戏 —— **仅外链**（网盘/直链）+ 封面与截图，平台不托管游戏文件（D1）
- `IMAGE` 图片 —— 多张图图集（封面 + 预览），可整包外链下载
- 预留：`AUDIO` / `MODEL` / `TOOL` / `ARTICLE`

**字段分层**

```
Resource
├── 公共字段
│   ├── title / description(富文本) / summary
│   ├── type / categoryId / tags[]
│   ├── coverMediaId(封面)
│   ├── status: DRAFT|PENDING|PUBLISHED|REJECTED|REMOVED|BANNED
│   ├── slug / authorId
│   ├── 冗余计数: view/like/favorite/comment/download Count
│   ├── loginRequired(是否需登录下载,D3) / allowComments / isDownloadable
│   └── createdAt / updatedAt / publishedAt
├── GAME 专有（D1 精简）
│   ├── externalUrl        ← 主下载形态：网盘/直链（含提取码说明）
│   ├── gameSource         # 信息填在 meta：版本/大小/语言/平台(win/mac/linux/安卓)/汉化/是否破解类目(合规见 §10)
│   ├── 封面 + 截图若干张（仍走 Media 图片管线）
│   └── 授权声明
└── IMAGE 专有
    ├── 多图 Media[]（封面任选其一）；分辨率/大小读取自图片
    ├── 整包下载 externalUrl（可选，如壁纸包/原图包）
    ├── meta（D2 四类均需）：
    │   ├── isAiGenerated / aiTool(工具或平台) / aiModel(模型)  # AI 标注
    │   ├── original(是否原创) / license(授权协议)              # 原创与授权声明
    │   └── sourceNote(来源说明/转载声明)
    └── 分类倾向（壁纸/插画/摄影/截图…）走 Category
```

> **差异通过「类型字典 + 按类型渲染的表单/详情模板」实现**，不拆两套系统。

### 3.2 Media（媒体实体，图片/封面/附件通用）

- kind：`COVER` / `GALLERY` / `ORIGINAL` / `ATTACHMENT`（附件预留，D1 下仅图片用前三种）
- 图片：`storageKey` / `thumbKey`(缩略图) / `width` / `height` / `size` / `mime` / `blurhash`
- 处理状态：`PENDING_PROCESS` → `READY` / `FAILED`（sharp 异步缩略图 + blurhash）
- 归属：`resourceId`；V1 扩展 `commentId`（D8 评论带图）

### 3.3 首页信息流（Civitai 式浏览）
- 主视图：卡片瀑布流（封面图为主），桌面多列 / 移动双列
- 过滤条：类型(GAME/IMAGE/全部) · 分类下拉 · 排序(最新/热门/最多下载/最多点赞) · 时间窗(全部/今日/本周/本月)
- 登录用户增加「关注」Tab（只看关注作者）
- 无限滚动（RSC + `useInfiniteFeed`，游标分页）

---

## 4. 页面与路由（App Router）

### 4.1 前台

| 路由 | 页面 | 关键元素 |
|---|---|---|
| `/` | 首页信息流 | 类型/分类/排序条 + 瀑布流卡片；「推荐/最新/热门」Tab（登录含「关注」） |
| `/browse` | 综合发现 | 左筛(类型/分类/标签/时间/排序/仅外链可下) + 网格/列表视图切换 |
| `/resources/[slug]` | 资源详情 | 灯箱图集 + 作者/标签/下载按钮(外链跳转)/收藏点赞/统计；描述；评论区；相关推荐 |
| `/upload` | 发布向导 | ①类型与分类 → ②标题/描述/标签 → ③图片上传 或 游戏外链+封面截图 → ④提交(直接发布 or 提示「待审核」) |
| `/u/[username]` | 用户主页 | 资料卡/统计(作品/粉丝/获赞/下载)；Tabs：作品/收藏/关注者/关注中；关注按钮 |
| `/collections/[id]` | 收藏夹 | V1 |
| `/tags/[tag]` `/search` | 标签页 / 搜索 | 聚合流；搜索结果含用户 |
| `/login` `/register` `/settings` | 认证与设置 | 邮箱密码 + GitHub OAuth；头像/资料/通知偏好 |
| `/notifications` | 通知中心 | 关注/点赞/评论/审核结果/系统分组 |

### 4.2 管理端（Moderator/Admin）

| 路由 | 页面 |
|---|---|
| `/admin` | 概览：待审数/举报数/今日发布 |
| `/admin/moderation` | 审核队列：**原始图预览** → 通过 / 打回(原因→通知作者) / 下架 |
| `/admin/reports` | 举报处理 |
| `/admin/users` | 用户列表：封禁/解封、角色、**trusted 免审标记** |
| `/admin/resources` | 内容库：检索/下架/恢复 |
| `/admin/categories` `/admin/tags` | 分类与标签治理 |

> 同一 Next 应用内，`middleware.ts` + layout 双层角色门控，先不拆独立 admin 端。

---

## 5. 数据模型（Prisma Schema 草案）

> 字段以实现时为准；此处是结构与关系约定。表含 D3/D6 落点（loginRequired、User.trusted）。

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  username  String   @unique
  passwordHash String?
  name      String?
  avatarKey String?
  bio       String?
  role      Role     @default(USER)
  trusted   Boolean  @default(false)   // D6 白名单免审
  bannedAt  DateTime?
  resources Resource[]
  comments  Comment[]
  likes     Like[]
  favorites Favorite[]
  following Follow[] @relation("Following")
  followers Follow[] @relation("Follower")
  notifications Notification[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Account / Session / VerificationToken   // Auth.js v5 标准表

model Category {
  id       String @id
  slug     String @unique
  name     String
  parentId String?
  type     ResourceType?      // 绑定大类，空则通用
  sort     Int     @default(0)
}

model Tag { id String @id; name String @unique; slug String @unique; count Int @default(0) }

model Resource {
  id            String        @id
  slug          String        @unique
  title         String
  summary       String?
  description   String
  type          ResourceType
  categoryId    String?
  authorId      String
  status        ResourceStatus @default(PENDING)  // D6
  rejectReason  String?
  coverMediaId  String?
  coverMedia    Media?  @relation("Cover", fields:[coverMediaId], references:[id])
  tags          TagOnResource[]
  media         Media[]
  versions      ResourceVersion[]
  comments      Comment[]
  viewCount      Int @default(0)   likeCount Int @default(0)
  favoriteCount  Int @default(0)   commentCount Int @default(0)
  downloadCount  Int @default(0)
  isDownloadable Boolean @default(true)
  loginRequired  Boolean @default(false)  // D3
  allowComments  Boolean @default(true)
  externalUrl    String?          // D1 游戏/整包外链
  meta           Json?            // 类型化扩展：AI标注/授权/系统要求等
  createdAt DateTime @default(now()); updatedAt DateTime @updatedAt; publishedAt DateTime?
  @@index([status, type]); @@index([authorId]); @@index([categoryId])
  @@index([status, publishedAt(sort: Desc)])
}

model Media {
  id         String @id
  resourceId String?
  commentId  String?      // V1 评论带图(D8)
  kind       MediaKind
  storageKey String
  thumbKey   String?
  width Int? height Int? size BigInt? mime String? blurhash String?
  fileName String? checksum String?
  sort Int @default(0)
  status MediaStatus @default(PENDING_PROCESS)
  createdAt DateTime @default(now())
}

model ResourceVersion { id; resourceId; version; changelog?; mediaId?; downloadCount; createdAt }  // 预留

model TagOnResource { resourceId; tagId; @@id([resourceId,tagId]) }   // 增删时事务维护 tag.count

// —— 社交 ——
model Like { id; userId; resourceId; createdAt; @@unique([userId,resourceId]) }
model Favorite { id; userId; collectionId?; resourceId; createdAt; @@unique([userId,resourceId]) }
model Collection { id; ownerId; name; description?; coverResourceId?; isPublic Bool @default(true); items Favorite[]; createdAt }
model Comment { id; resourceId; authorId; parentId?; content; status; likeCount; createdAt; @@index([resourceId,createdAt]) }
model Follow { followerId; followingId; createdAt; @@id([followerId,followingId]); @@index([followingId]) }
model Notification { id; userId; actorId?; type; resourceId?; commentId?; message?; readAt?; createdAt; @@index([userId,readAt]) }

// —— 治理 ——
model Report { id; reporterId; type; targetResourceId?; targetCommentId?; targetUserId?; reason; detail?; status; handledBy?; createdAt }
model AuditLog { id; adminId; action; targetType?; targetId?; note?; createdAt }

enum Role { USER MODERATOR ADMIN }
enum ResourceType { GAME IMAGE }
enum ResourceStatus { DRAFT PENDING PUBLISHED REJECTED REMOVED BANNED }
enum MediaKind { COVER GALLERY ORIGINAL ATTACHMENT }
enum MediaStatus { PENDING_PROCESS READY FAILED }
enum CommentStatus { PUBLIC HIDDEN DELETED }
enum NotificationType { FOLLOW LIKE COMMENT MODERATION SYSTEM }
enum ReportTarget { RESOURCE COMMENT USER }
enum ReportStatus { OPEN RESOLVED DISMISSED }
```

**要点**：冗余计数 + 事务累加（`lib/counters.ts`）；软下架用 `status=REMOVED/BANNED` 保留可恢复；`meta` 用 zod 校验器按 type 分型后再落库。

---

## 6. 核心业务流程

### 6.1 发布 / 上传（D1/D6）
```
上传向导
  → 类型/分类 → 标题/描述/标签 → 图片多张 或 游戏外链+封面截图
  → 图片走 sharp 管线(PENDING_PROCESS→READY)
  → 提交：
      author.trusted ? status=PUBLISHED(直发,D6) : status=PENDING(入审核队列)
  → 通知作者（直发成功 / 已进入待审）
审核通过 → PUBLISHED + publishedAt=now → 通知作者
```
- 游戏：**不上传文件**；`externalUrl` 指向网盘/直链，作者可填提取码。平台无需大文件存储。
- 图片单张 ≤ 20MB，先本地 Storage（生产 S3/R2 + CDN）。

### 6.2 图片处理管线（异步）
```
Media(status=PENDING_PROCESS)
  → sharp: 生成 大图(如1200w,webp) + 缩略图(400w) + blurhash
  → READY；失败重试 N 次后 FAILED（管理端可重跑）
```
- 首屏只出缩略图；详情灯箱按需原图（blurhash → 渐进）。

### 6.3 互动与防刷
- 点赞/收藏：`@@unique` 去重，事务 ± 计数。
- 浏览：会话级去重，防刷新刷量。
- 下载：点外链 +1；`loginRequired` 未登录先引导登录（D3）。
- 评论作者被通知；V1 不做置顶/带图。

### 6.4 治理（D6）
- 可信作者直发内容进入事后队列抽查；被举报后自动暂转 PENDING 复查。
- 审核页必须显示**原图 + 放大**，避免凭缩略图误判。
- 举报按同目标次数加权排序；动作都写 `AuditLog`；封禁联动隐藏内容。

---

## 7. 技术架构

| 层 | 选型 | 备注 |
|---|---|---|
| 框架 | Next.js 16 App Router + RSC | 已初始化 |
| 语言/样式 | TypeScript strict · Tailwind v4 | 已初始化 |
| 认证 | Auth.js v5 (next-auth@beta) + Prisma adapter | Credentials(bcrypt) + GitHub OAuth（D4） |
| ORM/DB | Prisma · SQLite(开发)/PostgreSQL(生产) | 平滑迁移 |
| 校验 | zod | 与 RSC/server action 共用 schema |
| 图片处理 | sharp + blurhash | Node runtime |
| 存储 | `StorageService` 抽象：本地(SQLite 期)/S3-R2(生产) | 键即相对路径，统一接口 |
| 异步 | 轻量队列（缩略图/通知） | 生产可换 BullMQ |
| 搜索 | V1 数据库(ILIKE+标签) · V2 Meilisearch | 见路线图 |
| UI | 手写轻量组件(Tailwind) 简洁画廊风 | 双端响应式 |

原则：Server Actions + RSC 优先；交互组件薄；计数复用 `lib/counters.ts`；图片一律缩略图入口。

---

## 8. 推荐目录结构

```
src/
├── app/
│   ├── (public)/  page.tsx / browse/ / resources/[slug]/ / search/ / tags/[slug]/ / u/[username]/
│   │   / collections/[id]/
│   ├── (auth)/  login/ register/ settings/
│   ├── upload/
│   ├── notifications/
│   ├── admin/  page/ moderation/ reports/ users/ resources/ categories/ tags/
│   ├── api/ auth/[...nextauth]/route.ts   upload/route.ts
│   └── layout.tsx globals.css
├── components/
│   ├── ui/            # 基础：Button/Input/Dialog/Dropdown/Toast…
│   ├── layout/        # Navbar/Footer/UserMenu/ResponsiveMenu
│   ├── resource/      # ResourceCard/CoverImage/Lightbox/UploadSteps/DetailPanel
│   ├── feed/          # FeedGrid/FilterBar/MobileFilterSheet
│   └── social/        # LikeButton/FavoriteButton/CommentThread/FollowButton
├── lib/
│   ├── db/prisma.ts seed.ts
│   ├── auth.ts auth.config.ts
│   ├── storage/ index.ts local.ts s3.ts(预留)
│   ├── media/ process.ts           # sharp+blurhash
│   ├── counters.ts slug.ts validators.ts notify.ts queue.ts
├── prisma/schema.prisma
├── types/
├── hooks/  useInfiniteFeed.ts useUpload.ts
├── middleware.ts
└── tests/
```

---

## 9. 存储与媒体约定

- 键：封面/图集 `r/{resourceId}/{mediaId}_orig.{ext}` + `_{400|1200}w.webp`；头像 `u/{userId}/avatar.{ext}`
- 开发期存 `./uploads`（gitignore）；生产对象存储 + CDN
- **无平台游戏文件**：仅图片/封面/头像流量（D1）
- 上传安全：服务端魔数校验 + 扩展名白名单 + 路径穿越防护；附件 sha256（预留去重）

---

## 10. 安全与合规

- PENDING 资源及原始图在过审前不向游客公开；可信直发内容仍可事后下架。
- 全部输入 zod + 白名单 sanitizer；密码 bcrypt；DB session 可撤销。
- **游戏外链风险（D1 关键）**：允许合法游戏/汉化/免费资源；**禁止破解、盗版、侵权内容**——分类引导 + 举报类型「侵权/盗版」+ 规则页；违规外链直接下架。
- AI 生成图片须显式标注（合规与社区信任）；原创/授权字段便于追溯（D2）。
- 限流：登录/上传/评论速率限制；AuditLog 全留痕。

---

## 11. 分阶段路线图

### MVP（当前目标）
1. 认证：Auth.js v5，邮箱密码 + GitHub OAuth（D4）
2. Prisma + SQLite，schema + 迁移 + seed（管理员/分类/标签/示例资源）
3. 图片上传管线（sharp 缩略图/blurhash）+ 本地 Storage；游戏仅外链表单（D1）
4. 前台：首页瀑布流 + 分类/排序 + 详情(灯箱/外链/评论) + 作者主页 + 搜索/标签（D5 双端）
5. 社交：点赞/收藏/评论/关注/通知
6. 治理：审核队列 + 举报 + trusted 白名单免审 + 封禁（D6）
7. 视觉：简洁画廊风（D7）

### V1
- 评论带图（D8）、收藏夹、创作者标识
- 管理后台完善（用户管理/审计/全局设置/抽查队列）
- 邮件通知、S3/R2 + CDN、PostgreSQL

### V2
- 全文搜索(Meilisearch)、个性化推荐、榜单/推荐位
- 私信、社区规范增强、晒图回帖生态

---

## 12. 附录：为什么用「单 Resource + type 分型」

- 复用全部社交/审核/搜索/通知逻辑，避免 N 套平行代码；
- 类型扩展 = 加枚举 + 类型化 meta 校验器 + 专属表单/详情模板；
- Civitai 的 Model 即典型「一主体 + 多图 + 多版本」，天然适配单 Resource 模型。
