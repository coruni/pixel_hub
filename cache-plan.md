# 缓存与加载性能 · 可上线实施方案

> 目标：用 Redis 承载服务端缓存 + 分阶段开启数据/页面缓存，压低每次请求的查库次数与首字节时间。
> 版本事实来源：`node_modules/next/dist/docs/`（本仓库 Next.js 16.3.4）。所有 API 结论均按该版本核对，非记忆。
> 原则：**每一批都可单独上线、单独回滚**；任何一批出问题，删掉环境变量重启即回到接入前状态。

---

## 0. 结论先行

| 项 | 结论 |
|---|---|
| 现状 | **全站零服务端缓存**。每个请求都要重新查库；`revalidatePath` 有 143 处，但没有任何东西被缓存 |
| 已落地 ① | **Redis 缓存后端**（`cache-handler.js` + 条件注册）。**未配置 `REDIS_URL` 时行为与接入前完全一致** |
| 已落地 ② | **全局配置跨请求缓存**（SEO / 主题 / 运行配置三个读取器 + 标签失效）。**不依赖 Redis 也能生效** |
| 待议 ③④ | 热内容数据缓存、页面缓存（后者需先解开顶层鉴权耦合） |
| 需要你拍板 | Redis 部署形态（同机容器 / 托管）与实例数；以及第 ④ 批是否接受前端结构改动 |

**最重要的一个发现**：全站之所以每页都动态渲染，直接原因是 `src/app/layout.tsx` 里调用了一次 `auth()`，而这个结果只用来给 `<PresencePing signedIn={boolean} />` 传一个布尔值；再加上 `Navbar` 自己也调 `auth()`。**要拿到真正的整页缓存，必须先解开这个耦合**（详见第 6 节）。

---

## 1. 现状盘点（全部可复核）

### 1.1 缓存 API 使用情况

| API | 出现次数 | 说明 |
|---|---|---|
| `revalidatePath` | **143** | 全站失效手段只有这一种 |
| `revalidateTag` | 0 | 没有标签化失效 |
| `unstable_cache` | 0 | **没有任何跨请求数据缓存** |
| `use cache` / `cacheTag` / `cacheLife` | 0 | 未启用 Cache Components |
| `redis` | 0 | 无 Redis 依赖 |
| `noStore` | 2 | 仅两处 |

### 1.2 每个请求的固定开销

| 来源 | 位置 | 性质 |
|---|---|---|
| 会话回查 | `src/lib/auth.ts:92,117` `prisma.user.findUnique` | **每次请求一次查库**（有意为之，见下） |
| SEO 配置 | `src/lib/seo-config.ts:94` `getSeoConfig` | `siteSetting` 查库 |
| 站点主题 | `src/lib/site.ts:13` `getTheme` | `siteSetting` 查库 |
| 运行配置 | `src/lib/runtime-config.ts:268` `getRuntimeConfig` | `siteSetting` 查库 |
| 首页板块 | `src/lib/home.ts:29` `getHomeSections` | `HomeSection` 查库（仅首页） |

这 4 个配置读取器都用了 React `cache()`——但它**只在单次请求内去重，跨请求不缓存**。也就是说：每个请求、无论命中与否，都要重新查 3～4 次库才能开始渲染页面本身。

`src/lib/actions/site.ts:29` 的注释把这件事写得很直白：

```ts
function themeRevalidate() {
  // 前台动态页每次请求现读 DB；这里刷新路由缓存与后台自身
```

### 1.3 为什么全站都是动态渲染

`src/app/layout.tsx:49`：

```ts
const [session, seo] = await Promise.all([auth(), getSeoConfig()]);
...
<PresencePing signedIn={Boolean(session?.user)} />
```

在当前渲染模型下，**渲染树里任何一处读 `cookies()`/`headers()` 都会让整个路由变成动态渲染**。`auth()` 读 cookie，于是：

- root layout 读一次 `auth()`（仅为传一个布尔值给心跳组件）
- `src/components/layout/Navbar.tsx:24` 又读一次 `auth()`（为了显示头像/登录入口）

结论：**整站没有一个路由能被静态化**，`revalidatePath` 的 143 处调用在当前状态下基本只作用于客户端路由缓存，对服务端查库量没有帮助。

**这一点已由真实构建输出证实**（`npm run build`，2026-09-22）。构建产物里几乎每个路由都标着 `ƒ (Dynamic) server-rendered on demand`：

```
├ ƒ /browse          ├ ƒ /privacy         ├ ƒ /rules
├ ƒ /creators        ├ ƒ /resources/[slug]├ ƒ /tags/[slug]
├ ƒ /fund            ├ ƒ /terms           ├ ƒ /u/[username]
├ ƒ /login           ├ ƒ /register        ├ ƒ /settings
○ (Static) 只有：/apple-icon.png、/icon.svg、/robots.txt、/sitemap.xml（1h 重新生成）
```

**连 `/rules`、`/terms`、`/privacy` 这三个纯静态文案页都是按需服务端渲染的** —— 这是当前架构最直白的浪费证据。另外 `/fund` 虽然写了 `export const revalidate = 300`，仍然落在 `ƒ (Dynamic)`：因为它继承的 root layout 读了 cookie，`revalidate` 被动态渲染覆盖掉了。这恰好印证了「不解开顶层鉴权耦合，页面级缓存就无从谈起」。

> 注意：在当前模型下用 `<Suspense>` 包住 `auth()` **并不能**让路由变静态——那是 Cache Components（PPR）才有的能力。这一点在第 6 节展开。

### 1.4 部署现状

- `Dockerfile` 是**单容器** `next start`，未用 `output: "standalone"`（镜像内带完整 `node_modules`）。
- 仓库内**没有** `docker-compose.yml` / `nginx.conf` / `Caddyfile`。
- `.env` 现有键：`AUTH_SECRET`、`AUTH_TRUST_HOST`、`DATABASE_URL`、`GITHUB_ID/SECRET`、`GRAPH_*`、`STORAGE_DRIVER`——**没有 `REDIS_URL`**。
- `next.config.ts` 已有 `headers()`（安全响应头）与 `redirects()`。

**这决定了 Redis 的定位**：如果长期是单实例 + 持久磁盘，Next 默认的「进程内 + 磁盘」缓存其实已经够用，Redis 的收益主要在于**多实例共享**与**重启/发布不丢缓存**。所以第 9 节把「你到底要不要扩容」列为必须先回答的问题。

---

## 2. 技术选型（按本仓库 Next 16.3.4 核对）

### 2.1 三套机制的区别（最容易踩错的地方）

| 机制 | 作用对象 | 是否需要 `cacheComponents` |
|---|---|---|
| `cacheHandler`（**单数**） | ISR 页面、路由处理器响应、`next/image` 优化结果、**`unstable_cache` 的数据** | 否 |
| `cacheHandlers`（**复数**） | 只服务 `'use cache'` / `'use cache: remote'` 指令 | **是** |
| `cacheComponents: true` | 启用 `use cache` 与 PPR（部分预渲染） | — |

**本项目用的是第一行**（未开 `cacheComponents`）。选它而不是 `cacheHandlers`，是因为后者在没开 `cacheComponents` 时完全不起作用。

### 2.2 为什么不直接上 `use cache` + PPR

`use cache` 是 Next 16 的推荐方向，`unstable_cache` 官方已标注「16 起被 `use cache` 取代」。但对本仓库：

- 开启 `cacheComponents: true` 会改变**整个渲染模型**：要求把每个异步/运行时访问都显式放进 `<Suspense>` 或标记缓存，否则开发覆盖层报错。本仓库有 331 个源文件、46 个页面路由，属于**大迁移**。
- PPR 会改变所有页面的交付形态（静态外壳 + 流式填充），需要真机重新做视觉验收（`AGENTS.md` 要求 7 档宽度 × 明暗双主题）。

**结论**：当前模型下用 `unstable_cache` 拿到 80% 收益，把 PPR 作为独立立项（第 10 节列为「不做/待议」），不混在这次改动里。

### 2.3 必须记住的两个 API 细节

1. **`revalidateTag` 必须传两个参数**：`revalidateTag(tag, "max")`。单参数形式在 16 已废弃，仅靠忽略 TS 报错才可用。
   - `"max"` = 一年窗口 → 走 stale-while-revalidate，用户永远拿到内容、后台刷新。
   - `{ expire: 0 }` = 下次请求阻塞式重建（要立即生效时用）。
   - 也可用 `updateTag`（Server Action 专用）做「写后立即可读」。
2. **`revalidatePath` 是 `revalidateTag` 的语法糖**：它会被折算成路径软标签（`_N_T_` 前缀）后走同一套标签系统。所以**仓库里现存的 143 处 `revalidatePath` 无需改动，就能在接入自定义缓存后端后继续正确失效**。这是本方案敢先上 Redis 后端的底气。

---

## 3. 本轮已落地：Redis 缓存后端

### 3.1 新增/改动

| 文件 | 改动 |
|---|---|
| `cache-handler.js`（新建，项目根） | 实现 `get` / `set` / `revalidateTag` / `resetRequestCache` 的 Redis 后端 |
| `next.config.ts` | 新增 `cacheBackend`：**仅当 `REDIS_URL` 非空时**注册 `cacheHandler` 并关闭进程内前置缓存 |
| `package.json` | 新增依赖 `redis`（官方 node-redis 客户端，与 Next 官方示例一致） |

### 3.2 关键设计点

- **二进制安全序列化**。缓存条目里的 `html` / `pageData` / `postponed` / `buffer` 是 Buffer；直接 `JSON.stringify` 会把它降级成 `{type:"Buffer",data:[…]}`，反序列化后不再是 Buffer，**页面渲染会直接报错**。所以显式按 `{__bin: base64}` 打标递归编解码。
- **标签反向索引**。写入时把 `key` 记进 `tag:<tag>` 集合，失效时反查删除。这样 `revalidateTag` 能跨实例生效，而不是只在当前进程内清内存。
- **降级不阻断**。Redis 不可用时回退进程内 Map 并只告警一次——与本仓库既有的 `src/lib/rate-limit.ts`、`src/lib/register-code.ts`（Postgres + 内存兜底）保持同一套约定。**缓存故障绝不能变成页面故障**。
- **`get()` 内部吞异常**。Next 不会给 `get()` 包 try/catch，抛出去就是渲染错误，所以必须自己兜住并返回 `null`（未命中语义）。
- **键前缀** `pixelhub:next:`，可用 `CACHE_KEY_PREFIX` 覆盖，避免与同一 Redis 上其他业务键撞名。

### 3.3 如何启用（三步，可回滚）

```bash
# 1) 起一个 Redis（同机容器即可，见第 9 节的取舍）
docker run -d --name pixelhub-redis --restart unless-stopped \
  -v pixelhub-redis:/data redis:7-alpine redis-server --appendonly yes

# 2) 在 .env 里加一行
REDIS_URL=redis://127.0.0.1:6379

# 3) 重新构建并启动
npm run build && npm run start
```

**回滚**：删掉 `REDIS_URL` 这一行并重启。`next.config.ts` 会在启动时判定不注册任何自定义后端，回到默认的进程内 + 磁盘缓存，与今天完全一致。

> 单实例部署若想同时保留进程内内存缓存（更快），设 `CACHE_KEEP_MEMORY=1`。
> **多实例部署不要设它**：否则 A 实例失效后，B 实例仍会拿自己内存里的旧条目继续发旧内容。

### 3.4 本轮的诚实边界

- 本机**没有 Redis 实例**，因此这套后端**没有做过真实 Redis 的端到端联调**（连接串、ACL、集群模式仍需上线前实测）。
- 已完成的验证：
  - `npx tsc --noEmit` 零错误；
  - handler 逻辑离线验证（24 条断言：二进制安全、过期判定、标签失效、`set(null)` 删除、未配 `REDIS_URL` 的降级、Redis 全故障时不抛异常）。验证脚本按用户要求已删除，备份在 `C:\Users\Amiya\.workbuddy-ai\backups\pixel_hub\_test_cache-handler.mjs.bak`，需要时取回；**接入真实 Redis 前建议先取回跑一遍**；
  - 用三个独立进程实测配置门控：不配 `REDIS_URL` 时 `cacheHandler` 与 `cacheMaxMemorySize` 均为 `undefined`（**与接入前逐字节一致**），配上后才注册；`headers` / `redirects` / `serverActions` 三处既有配置均未被影响；
  - `npm run build` 通过（10m31s），路由表与接入前一致（见 1.3 的构建产物证据）。
- 换句话说：**第 3 节交付的是「可切换的开关」，不是「已生效的加速」**。真正产生加速的是第 4 节起的批次。

---

## 4. 批次二：全局配置数据缓存（已落地，低风险）

### 4.1 目标

把每请求 3 次固定查库（SEO / 主题 / 运行配置）降为「首次查库、之后命中缓存」。

### 4.2 失效面已查清——这是本批敢做的原因

三个读取器都只读 `SiteSetting` 单表，且**每个键的写入点都只有 1～2 处**：

| 读取器 | 键 | 写入点 |
|---|---|---|
| `getSeoConfig` | `SEO_KEY = "seo"` | `src/lib/actions/seo.ts:31` |
| `getTheme` | `THEME_KEY = "theme"` | `src/lib/actions/site.ts:60`、`src/lib/site.ts:37` |
| `getRuntimeConfig` | `RUNTIME_CONFIG_KEY = "site-runtime"` | `src/lib/actions/runtime-config.ts:38` |

全仓库 `siteSetting` 写入点共 15 处，但落到这三个键上的只有上表 4 处。写入点少、集中、每处都有乐观锁版本校验，因此**标签失效可以做到无遗漏**。

### 4.3 实际改法（已完成）

1. 新建 `src/lib/cache-tags.ts` 作为标签唯一事实来源，并同时定义兜底 TTL：

   ```ts
   export const CACHE_TAGS = { siteSetting: "site-setting" } as const;
   export const CONFIG_CACHE_REVALIDATE_SECONDS = 300;
   ```

2. 三个读取器改为跨请求缓存。原先是 React `cache()`（**只做单次请求内去重**），现改为 `unstable_cache`：

   | 读取器 | `keyParts` | 标签 | 兜底 TTL |
   |---|---|---|---|
   | `getSeoConfig`（`seo-config.ts`） | `["seo-config"]` | `site-setting` | 300s |
   | `getTheme`（`site.ts`） | `["site-theme"]` | `site-setting` | 300s |
   | `getRuntimeConfig`（`runtime-config.ts`） | `["runtime-config"]` | `site-setting` | 300s |

   TTL 是**保险丝**：万一存在没覆盖到的写入路径，最坏也只是 5 分钟后自愈，而不是永久脏数据。

3. 写入点挂标签失效。实际只改了 **3 个文件**（比预想更集中）：

   | 文件 | 说明 |
   |---|---|
   | `src/lib/actions/site.ts` → `themeRevalidate()` | 该 helper 是主题写入的**唯一出口**（8 处调用全覆盖），所以标签失效挂这一处即可 |
   | `src/lib/actions/seo.ts` → `updateSeoConfigAction` | 写回成功后失效 |
   | `src/lib/actions/runtime-config.ts` → `updateRuntimeConfigAction` | 写回成功后失效 |

4. **`src/lib/site.ts` 的 `ensureSiteTheme()` 刻意不加 `revalidateTag`**，两个原因：
   - 它是在**页面渲染期**被调用的（`src/app/admin/site/page.tsx`），而 `revalidateTag` 只能在 Server Action / Route Handler 里调用；
   - 也不必要——它落库的值就是 `serializeTheme(DEFAULT_THEME)`，与 `getTheme` 在「行不存在」时返回的默认值**完全等价**，缓存里那份旧结果依然正确。

5. **失效顺序已核对**：`actions/site.ts` 的 8 处调用全部是 `await writeThemeDoc(doc)`（失败即 `return CONFLICT`）→ `await audit(...)` → `themeRevalidate()`。也就是说**写入先提交、再失效**，不存在「失效完又把旧值重新缓存进去」的竞态。seo / runtime-config 两处同样是写回成功后才失效。

### 4.4 ⚠️ `getRuntimeConfig` 有一个必须先处理的陷阱

`src/lib/runtime-config.ts:270-278` 在读配置的同时**有副作用**：

```ts
export const getRuntimeConfig = cache(async (): Promise<RuntimeConfig> => {
  const row = await prisma.siteSetting.findUnique({ where: { key: RUNTIME_CONFIG_KEY } });
  const cfg = row ? parseRuntimeConfig(safeJson(row.value)) : DEFAULT_RUNTIME_CONFIG;
  if (cfg.storageDriver === "s3") {
    const base = s3PublicBase(cfg);
    setS3Runtime(base ? { driver: "s3", base } : null);   // ← 进程内镜像
  } else {
    setS3Runtime(null);
  }
  return cfg;
});
```

如果直接对整函数套 `unstable_cache`，**命中缓存时 `setS3Runtime` 不会执行**，进程内 S3 公开基址镜像可能停留在旧值或空值，进而拼错资源 URL。

**已按此重构完成**：把纯读取拆成 `readRuntimeConfig`（`unstable_cache` 包住，只做查库 + 解析），
`getRuntimeConfig` 保留 React `cache()` 做请求内去重，并**每次调用都执行** `setS3Runtime` 副作用：

```ts
const readRuntimeConfig = unstable_cache(
  async (): Promise<RuntimeConfig> => {
    const row = await prisma.siteSetting.findUnique({ where: { key: RUNTIME_CONFIG_KEY } });
    return row ? parseRuntimeConfig(safeJson(row.value)) : DEFAULT_RUNTIME_CONFIG;
  },
  ["runtime-config"],
  { tags: [CACHE_TAGS.siteSetting], revalidate: CONFIG_CACHE_REVALIDATE_SECONDS },
);

export const getRuntimeConfig = cache(async (): Promise<RuntimeConfig> => {
  const cfg = await readRuntimeConfig();
  // 副作用留在缓存外面：命中缓存时也必须跑，否则 S3 公开基址镜像会残留旧值
  if (cfg.storageDriver === "s3") {
    const base = s3PublicBase(cfg);
    setS3Runtime(base ? { driver: "s3", base } : null);
  } else {
    setS3Runtime(null);
  }
  return cfg;
});
```

这是本批次唯一的实现难点。**通用教训**：把「读配置」函数套进任何跨请求缓存之前，先确认它有没有夹带副作用——命中缓存时副作用不会执行，而这类 bug 通常表现为「某个 URL 拼错了」，很难一眼归因到缓存。

### 4.5 预期收益与风险

- 收益：每请求少 3 次查库（登录态另有一次 `auth` 回查，见 4.6）。在自建 Postgres 同机场景约省 3～15ms/请求，高并发下更重要的是**把连接池压力挪走**。
- 风险：配置改完后台不生效（由 4.3 的标签失效覆盖 + TTL 兜底兜住）。
- 验收：改后台站点名 → 刷新前台立即变化；连续刷新页面确认缓存命中（看 Redis `INFO stats` 的 `keyspace_hits`）。
- **已执行的验证**：`npx tsc --noEmit` 零错误；`npx eslint` 对全部 7 个改动文件零告警；`npm run build` 通过（11m33s）；失效顺序逐处核对（写入先提交、再失效）。
- **尚未执行的验证**：改后台配置后前台是否立即变化，需要**起一个运行实例手工走一遍**。数据库是通的（已实测 `siteSetting` 5 行、`tag` 124 行），所以这条完全可以做，只是本次未做——**上线前必须补**。
- 构建期间踩到一个与本方案无关的坑，记录在此以免误判：仓库里已提交的 `prisma/_tip-cdp-check.mts`（别人的 CDP 检查脚本）曾贡献 26 个 `tsc` 错误，把 `npm run build` 拦死。因为 `tsconfig.json` 的 `include` 含 `**/*.mts`，**仓库内任何位置的临时脚本都会被一起类型检查**。该文件已按用户要求删除。

### 4.6 明确**不**缓存的东西

- **`auth()` 的每请求 DB 回查**（`src/lib/auth.ts:92,117`）：这是有意的安全设计，让封禁 / 降权 / 改密立即生效，安全审计报告把它列为强项。**不要为了性能把它缓存掉。** 若确有需要，只能另立项做「带短 TTL 的失效名单」，并重新做安全评审。
- **`getHomeSections`**：读的是 `HomeSection` 表（可增删排序），写入点比 `SiteSetting` 分散，放到批次三一起做。

---

## 5. 批次三：热内容数据缓存

针对真正吃 DB 的读路径（`src/lib/queries.ts`，1353 行）：

| 函数 | 现状 | 建议 |
|---|---|---|
| `getFeed`（:213） | 无缓存，列表主路径 | 加 `unstable_cache`，标签 `feed`，TTL 60～120s |
| `getResourceDetail`（:336） | 已有 React `cache()`（请求内去重） | 升级为跨请求缓存，标签 `resource:<id>`，失效挂在资源编辑/审核/下架 |
| `getRelated`（:571） | 无缓存 | 按资源 id 缓存，TTL 较长（相关推荐对时效不敏感） |
| `getRecommendations`（:1027） | 无缓存 | 同上 |
| `getCategories` / `getTopTags`（:321/:325） | 已有 React `cache()` | 跨请求缓存，标签挂分类/标签的增删改 |
| 侧栏 widget（`src/components/sidebar/widgets/*`） | 每个 widget 独立查库 | 按 widget 类型 + 页面分组缓存，TTL 短 |

**这一批必须逐个函数确认三件事**，否则就是「缓存了但没人负责失效」：

1. 写入点在哪（`revalidateTag` 挂上去）；
2. 返回值是否可安全序列化（含 `Date` / `Buffer` / `Decimal` 的要先规整）；
3. **是否夹带副作用**（如 4.4 的 `setS3Runtime`）。

`queries.ts` 已到 1353 行、远超 `AGENTS.md` 的 800 行硬上限。**建议借这一批顺手按领域拆分**（如 `queries/feed.ts`、`queries/resource.ts`），而不是继续往里加缓存包装。

---

## 6. 批次四：页面缓存（本次的核心，风险最高）

### 6.1 唯一的真正障碍：鉴权耦合在渲染树顶层

如 1.3 所述，`layout.tsx` 与 `Navbar.tsx` 各调一次 `auth()`，导致全站动态。要拿到整页缓存，必须把「读会话」从服务端渲染主路径上摘掉。

### 6.2 三个方案对比

| 方案 | 做法 | 收益 | 代价 / 风险 |
|---|---|---|---|
| **A. 前端化会话态** | `Navbar` 与 `PresencePing` 的登录态改由客户端获取（新增一个轻量 `GET /api/session` 返回 `{signedIn, user}`，或复用现有 `/api/notifications/unread` 的 401 判定）。服务端渲染不再读 cookie | 路由可静态化，整页缓存收益最大 | 首屏会出现「登录态闪一下」；需要处理水合一致性；涉及公共组件，回归面广 |
| **B. 开 Cache Components（PPR）** | `cacheComponents: true`，用 `use cache` + `<Suspense>` 让静态外壳与用户态并存 | 官方主推方向，长期最优 | **大迁移**：331 文件、46 路由；需重做全部视觉验收；`unstable_cache` 还要迁到 `use cache` |
| **C. 只缓存数据，不缓存整页** | 不动渲染结构，把 4～5 节的数据库读全部缓存掉 | 无需改鉴权结构，风险最低 | 拿到的是「查库变快」，不是「免渲染」；HTML 仍需每请求生成 |

### 6.3 推荐路径

**C → A 分两步走，B 单独立项。**

理由：

1. 第 4、5 批（= C）已经把最大头的 DB 压力解决，且**完全不动鉴权与渲染结构**，可以先上线吃收益。
2. 等 C 稳定运行一段时间、拿到真实收益数据后，再评估是否值得为 A 付出「登录态闪烁 + 公共组件回归」的代价。很多站点在 C 之后已经够快了。
3. B 与 C/A 是**互斥的重构路线**（`use cache` 会取代 `unstable_cache`）。先做 C 再上 B，等于同一份工作做两遍。所以如果长期一定要走 B，就该**跳过 C 直接规划 B**——这是需要你拍板的分叉点。

### 6.4 如果走 A：灰度与回滚

- 先只对**无个性化内容的公开页**开静态化：`/rules`、`/terms`、`/privacy`、`/fund`（已有 `revalidate = 300`）、`/creators`。
- 逐个路由加 `export const revalidate = N`，用真实截图验收（`AGENTS.md`：320/375/390/430/768/1024/1440px × 明暗双主题）。
- **绝不能缓存**：`/admin/*`、`/settings`、`/notifications`、`/me/*`、`/drafts`、`/upload`、资源详情页的 NSFW 分支（未登录必须 404 + noindex，缓存穿透会导致 NSFW 泄露）。
- 回滚：删掉对应路由的 `revalidate` 导出即回到动态渲染。

---

## 7. 多实例加固（仅在确实要水平扩容时做）

单容器部署**不需要**这一节。一旦要跑 2 个及以上实例，除 Redis 外还必须：

| 项 | 不做的后果 |
|---|---|
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`（同一值给所有实例） | Server Action 跨实例解密失败，报 `Failed to find Server Action` |
| `deploymentId` | 滚动发布期间客户端拿到旧构建的 action id / 资源，导航失败 |
| `output: "standalone"`（`next.config.ts`） | 镜像体积大、冷启动慢 |
| 反代关闭响应缓冲（nginx `X-Accel-Buffering: no`） | 流式渲染被缓冲，首字节优势消失 |
| 负载均衡支持 chunked / HTTP2 | 同上 |

---

## 8. 验收清单

| 项 | 方式 |
|---|---|
| 类型/静态 | `npx tsc --noEmit` 零错误；`npm run lint` 不新增 warning（注意基线本就不是全绿） |
| 构建 | `npm run build`（约 10 分钟，需后台跑；本机 safe-delete 守卫会拦，见下） |
| 行为不变性（本轮） | **不设 `REDIS_URL` 启动，确认 `next.config.ts` 不注册自定义后端**，页面与接入前一致 |
| Redis 命中 | `redis-cli INFO stats` 观察 `keyspace_hits` / `keyspace_misses` 随访问变化 |
| 失效正确性 | 改后台站点名 / 主题 / 运行配置 → 前台立即生效；改资源 → 详情页立即生效 |
| 跨实例失效（多实例时） | 两个实例各改一次配置，确认另一实例不再发旧内容 |
| 故障降级 | 停掉 Redis，确认页面**仍然正常渲染**（只是变慢），且日志只有一条告警 |
| 视觉 | 真机 7 档宽度 × 明暗双主题；本轮不改 UI，用于确认无回归 |

> 本机 `npm run build` 会被 safe-delete 守卫拦下（阈值 50 文件/轮，`next build` 清 `.next/turbopack` 时正好卡阈值）。这不是代码问题，放开方式：
> `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npm run build`

---

## 9. 风险与取舍

| 风险 | 处置 |
|---|---|
| **缓存脏数据**（最需要防的） | 标签失效 + 兜底 TTL 双保险；TTL 让最坏情况变成「几分钟后自愈」而非永久错误 |
| **缓存把私密内容发出去** | 只缓存明确的公共数据；`/admin`、`/me`、`/settings`、NSFW 分支一律不进缓存；批次四上线前单独做一次越权核查 |
| 带上副作用的函数被缓存（如 `getRuntimeConfig`） | 第 4.4 节已识别；批次二必须先拆函数再缓存 |
| 单实例场景 Redis 收益不划算 | 第 9 节待拍板项；单实例可先只做批次二、三（用默认磁盘缓存即可），Redis 等扩容再上 |
| Redis 成为单点故障 | handler 内建降级：Redis 挂了退进程内缓存，页面照常渲染 |
| Redis 内存涨到 OOM | 条目带 TTL；标签集合与条目同 TTL；建议给 Redis 配 `maxmemory-policy allkeys-lru` |
| 依赖 `unstable_cache` 而它已被标记取代 | 第 2.2 节已说明；这是当前模型下的正解，迁移到 `use cache` 属独立立项 |
| 多实例下 Server Action 解密失败 | 第 7 节；扩容前必须配 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` |
| 构建期预渲染需连库 | `Dockerfile` 已注明；`cacheHandler` 在构建期也会被加载，handler 已做无 Redis 时的安全降级 |

---

## 10. 待你拍板

1. **Redis 部署形态**：同机 Docker 容器（最省事，与现有单容器部署一致）／云托管 Redis（多实例友好，多一份成本与网络延迟）？
2. **实例数**：短期是否仍为单实例？若长期单实例，批次二、三可以直接用 Next 默认的磁盘缓存先吃到收益，**Redis 可以推迟**——需要你确认是否仍要现在引入。
3. **长期路线**：走「C（数据缓存）→ A（前端化会话态）」，还是直接投入「B（Cache Components + PPR）」？这两条路**不要都做**（第 6.3 节）。
4. **兜底 TTL**：批次二已按 300s 落地（`CONFIG_CACHE_REVALIDATE_SECONDS`）。要更保守就调小、更省库就调大——只改这一个常量。
5. **是否继续做批次三**（热内容数据缓存）？它收益更大，但涉及 `queries.ts` 里多个函数逐个确认写入点与副作用，工作量明显高于批次二。

---

## 11. 明确不做（本轮范围外）

- 不开 `cacheComponents` / PPR（第 2.2 节）。
- 不缓存 `auth()` 的每请求 DB 回查（第 4.6 节，安全设计，不拿性能换）。
- 不改任何安全响应头、CSP、限流与鉴权逻辑——本轮只碰缓存。
- 不顺手重排 `queries.ts`（第 5 节建议了拆分，但那是独立重构）。
- 不动 `Dockerfile`、不加 `output: "standalone"`（属第 7 节扩容加固）。
