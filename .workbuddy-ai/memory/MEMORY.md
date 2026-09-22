# Pixel Hub 项目长期笔记

## 验证与工具链

- **`_test/` 现在存在且被 git 跟踪**，里面只有 `incentive-conserve.ts`（激励/PIX/收支守恒自检，69 条纯函数断言 + 一组需真库的 DB 不变量断言，无库时明确 SKIP）。跑法：`npm run test:incentive`，几秒钟出结果。
- **`npm run test:smoke` / `npm run test:admin-data` 已于 2026-09-22 从 `package.json` 移除** —— 它们指向的 `_test/smoke.mjs`、`_test/admin-data.mjs` 从来不存在，是死链。因此 **AGENTS.md 里「跨核心流程改动要跑 `npm run test:smoke`」这条目前没有可执行的落地物**，只能用 `test:incentive` + `tsc` + `build` 代替，并在报告里说明证据限制。
- `src/app/api/dev-test/route.ts` 是**仅本地开发**的 action RPC 桥（生产 404），注册了 28 个 action 别名，原本专门给 `_test/*.mjs` 行为测试用。那两个测试文件没了之后**它已无消费者**；保留无害，但要用它就得先补回 `.mjs` 测试。
- **⚠️ `tsconfig.json` 的 `include` 含 `**/*.ts` / `**/*.mts`，所以仓库内任何位置的临时脚本都会被 `tsc` 一起检查，类型不干净会直接卡死 `next build`**。2026-09-22 就发生过一次：别人提交的 `prisma/_tip-cdp-check.mts`（CDP 检查脚本）贡献了 26 个 tsc 错误，把 `npm run build` 拦死。临时脚本要么类型干净，要么别放仓库里。判断「构建坏了是谁的锅」时，先 `npx tsc --noEmit 2>&1 | grep -oE "^[^(]+" | sort | uniq -c` 按文件归组，一眼看出。
- **⚠️⚠️ `tsconfig.json` 的 `include` 还显式包含 `.next/types/**/*.ts` 与 `.next/dev/types/**/*.ts`（第 29-30 行），`exclude` 只有 `node_modules`。** 这两处是 Next **生成**的路由类型校验文件。**所以：跑过 `next dev` 之后，如果删掉了当时存在的路由文件，`.next/dev/types/validator.ts` 会留下 `import(".../route.js")` 死引用，导致 `tsc --noEmit` 和 `npm run build` 双双报 `TS2307: Cannot find module`。** 2026-09-22 实测踩到。修法：`rm -rf .next` 后重建（`.next` 已被 gitignore，纯缓存）。**推论：临时新增/删除路由文件后，构建前必须清一次 `.next`**，否则会误判成自己的代码把构建弄坏了。
- **临时路由文件夹不能用 `_` 前缀**：Next App Router 把 `_` 开头的目录当 **private folder**，不参与路由（访问会落到 404 页而不是你的 handler）。仓库里临时**文件**的 `_tmp_*` 命名约定**不适用于路由目录**，要用 `src/app/api/tmp-xxx/route.ts` 这种形式。
- **⚠️ 本仓库有第二个 agent 会话在并发提交**（它用 `.workbuddy/` 目录，我用 `.workbuddy-ai/`）。2026-09-22 会话开始时 HEAD 是 `943220e`，结束时已被推到 `6d0443f`（多了 4 个提交）。**开工前与收尾前都要 `git log --oneline -5` 确认 HEAD 有没有移动**，否则会把对方未完成的工作误判成自己的问题。
- **`npm run build` 约需 10 分钟**，务必后台运行，不要用前台默认超时。
- **`npm run build` 会被本机 safe-delete 守卫拦下**：报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`，阈值 50 文件/轮，`next build` 清理 `.next/turbopack` 时正好卡在阈值上。这不是代码问题。放开方式：
  `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npm run build`
- 全仓库 `npm run lint` **2026-09-22 收尾时为 0 error / 7 warning**（7 个 warning 全是基线，分布在 `prisma/seed-bulk.ts`、`prisma/seed-extra.ts`、`admin/media/page.tsx`、`PublishForm.tsx`、`SiteSidebar.tsx`）。判断「是否新增问题」时先扣掉这些基线。**注意基线会漂移**：更早记录的「`_seed-demo.js` 有 3 个 `no-require-imports` error」已随该文件被删而消失；随后 `cache-handler.js` 的 `require("redis")` 又贡献过 1 个 error（已用 `eslint-disable-next-line` + 原因注释修掉，因为该文件**必须**是 CommonJS）。**所以别背基线数字，每次现跑一次 `npm run lint` 为准。**
- `src/lib/upload-config.ts` 是**前后端共用**的纯数据/校验层（不依赖 server），客户端组件可以直接 import。

### 需要验证纯逻辑 / 客户端逻辑时

- 纯数据层（如 `upload-config.ts`）：`npx tsx <脚本>` 直接加载真实模块即可。
- **客户端模块（如 `upload-attachment-client.ts`）可以脱离浏览器验证**，做法：本地 `node:http` 起模拟服务 + 一层 `XMLHttpRequest` shim + 包装 `globalThis.fetch` 补全相对路径。除 XHR 外全部用真实实现，不复刻业务逻辑。
  - 该脚本 `_tmp_upload_verify.mts` 已于 2026-09-22 按用户要求删除，备份在 `C:\Users\Amiya\.workbuddy-ai\backups\pixel_hub\_tmp_upload_verify.mts.bak`，需要时取回。
- 三个必须知道的坑：
  1. 脚本**必须用 `.mts`**。项目 `package.json` 无 `"type": "module"`，`tsx` 会把 `.ts` 当 CJS，顶层 await 报 `Top-level await is currently not supported with the "cjs" output format`。
  2. `tsconfig.json` 的 `include` 含 `**/*.mts` / `**/*.ts`，放项目根的临时脚本会被 `npx tsc --noEmit` 一起检查——要么让它类型干净，要么它会把 tsc 弄红。
  3. 函数声明式闭包拿不到类型收窄：`const s = map.get(k); if (!s) return;` 之后再写 `function f() { s.x }` 仍报 `possibly undefined`（函数声明会提升）。取一个非可选别名即可。
- 本地临时脚本按仓库约定命名 `_tmp_*`（`.gitignore` 第 53 行已覆盖），不会污染 git status。

## 上传链路

- 三条通道，由 `POST /api/upload/attachment/session` 的回答决定走哪条：
  1. `ok + ticket + uploadUrl` → 浏览器直传 OneDrive Graph 分片，本站只处理小 JSON
  2. `mode: "driver"` → 本站 `/api/upload/attachment/stream` 单请求流式落盘（本地/自建磁盘）
  3. `code: "NO_CLOUD"` → 回退 `/api/upload/attachment` 单请求 formData（受内存安全线约束）
- 是否走云盘由后台运行配置决定（`attachmentCloud` / `avCloud`），代码里不写死；判定集中在 `src/lib/av-upload.ts` 的 `resolveUploadTarget`。
- 落库的 `Media.kind` 三种上传来源**都用 `ATTACHMENT`**——MediaKind 是数据库枚举，为上传来源扩值需要不可回退的枚举迁移，收益极低。不要「顺手修正」这一点。

## OneDrive Graph 分片约束（改上传代码前必读）

- 每个 byte range **必须是 320 KiB（327,680 字节）的整数倍**。不整除不会当场报错，而是**传完最后一片才失败**——大文件传到底才炸。分片大小一律经 `snapChunkBytes()` 收口，不要手写裸字节数。
- 单请求体**必须 < 60 MiB**。
- 分片**必须按顺序**上传，不支持乱序。
- 所有分片的 `Content-Range` 里声明的**总文件大小必须一致**。
- 官方在稳定高速链路下推荐 10 MiB（= 32 × 320 KiB）；当前项目默认 40 MiB（= 128 × 320 KiB），见 `GRAPH_CHUNK_BYTES`。要调回 10 MiB 只改这一个常量，客户端原样跟随服务端下发值。
- 上传进度事件**必须用 XHR** 拿（`xhr.upload.onprogress`）：fetch 的 ReadableStream 请求体在浏览器里拿不到已发送字节数。
- 断点续传信息来自 `nextExpectedRanges`（形如 `["12345-", "77829-99375"]`，可能多段空洞，取最小起点）。也可对 `uploadUrl` 直接 **GET** 查询会话状态。
- 服务端会把 202 折叠成 200 的情况存在（网关行为）：**非末片收到 200/201 不能当作「整个文件已传完」**。
- 416 = 服务端已有该段（重复提交），属可重试；重试前应先 GET 对齐，否则会越重试越糟。

## 缓存与加载性能（2026-09-22 起）

- **接入前全站零服务端缓存**：`revalidatePath` 143 处，但 `revalidateTag` / `unstable_cache` / `use cache` / `redis` 全是 0。每个请求固定要查 3～4 次 `SiteSetting`（`getSeoConfig` / `getTheme` / `getRuntimeConfig`），外加 `auth()` 的每请求 `prisma.user.findUnique` 回查。这些读取器都只用了 React `cache()`，**只在单次请求内去重，跨请求不缓存**。
- **全站动态渲染的根因**：`src/app/layout.tsx` 调了一次 `auth()`，结果只用于给 `<PresencePing signedIn={boolean}/>` 传一个布尔值；`Navbar.tsx` 又调一次。当前渲染模型下渲染树里任何 `cookies()`/`headers()` 都会让整个路由动态化，**`<Suspense>` 包住也没用**（那是 Cache Components/PPR 才有的能力）。
- **Next 16 三套缓存机制别搞混**：
  - `cacheHandler`（**单数**，`next.config.ts`）→ 服务 ISR 页面 / 路由处理器 / `next/image` / **`unstable_cache` 的数据**。本项目用这个。
  - `cacheHandlers`（**复数**）→ 只服务 `'use cache'` 指令，**必须开 `cacheComponents: true`**，否则完全不起作用。
  - `cacheComponents: true` → 启用 `use cache` 与 PPR，会改变整个渲染模型（331 文件大迁移），**未启用**。
- `revalidateTag` 在 16 **必须传两个参数**：`revalidateTag(tag, "max")`。单参数形式已废弃，仅靠忽略 TS 报错才可用。`revalidatePath` 是 `revalidateTag` 的语法糖（折算成 `_N_T_` 软标签），所以现存的 143 处 `revalidatePath` **不用改**就能配合自定义缓存后端工作。
- **`next.config.ts` 的 `cacheHandler` 接受相对路径字符串**（已核对 Next 源码 `format-dynamic-import-path.js`：非绝对路径会 `path.join(dir, filePath)`）。不要写 `require.resolve` —— 本仓库 `tsconfig` 是 `module: esnext`，`require` 不存在会报类型错。
- **`getRuntimeConfig` 有副作用**：读配置时会 `setS3Runtime(...)` 同步进程内 S3 公开基址镜像。**直接对整函数套 `unstable_cache` 会让命中缓存时不执行副作用**，导致资源 URL 拼错。要缓存必须先把它拆成「纯读取」+「每次都要跑的副作用」两半。
- **不要缓存 `auth()` 的每请求 DB 回查**（`src/lib/auth.ts:92,117`）—— 那是让封禁/改密立即生效的安全设计，安全审计列为强项。性能不能拿它换。
- 已落地：`cache-handler.js`（Redis 缓存后端，含二进制安全序列化 + 标签反向索引 + 内存降级）、`next.config.ts` 里按 `REDIS_URL` 条件注册。**未配 `REDIS_URL` 时行为与接入前逐字节一致**，启用/回滚都只是增删这一行环境变量。
- **离线验证脚本已被用户要求删除**（原本是 `_test/cache-handler.mjs` + `npm run test:cache`，24 条断言，用假 Redis 验证二进制安全/过期/标签失效/降级/异常吞掉）。备份在 `C:\Users\Amiya\.workbuddy-ai\backups\pixel_hub\_test_cache-handler.mjs.bak`。**接入真实 Redis 前建议取回跑一遍**——目前 Redis 后端处于「逻辑写过但无测试守着」的状态。
- 方案文档：`cache-plan.md`（分四批上线，含待拍板项）。
- **批次二已落地（2026-09-22）**：`getSeoConfig` / `getTheme` / `getRuntimeConfig` 三个读取器由 React `cache()`（仅请求内去重）改为 `unstable_cache` 跨请求缓存，标签统一取 `src/lib/cache-tags.ts` 的 `CACHE_TAGS.siteSetting`，兜底 TTL `CONFIG_CACHE_REVALIDATE_SECONDS = 300`。**不依赖 Redis 也生效**（走 Next 默认磁盘缓存）。
  - 失效只改了 3 个文件：`actions/site.ts` 的 `themeRevalidate()`（主题写入唯一出口，8 处调用全覆盖）、`actions/seo.ts`、`actions/runtime-config.ts`。
  - **标签必须集中定义**：拼错标签是**静默失灵**——不报错，只表现为「后台改了前台不变」。
  - **`ensureSiteTheme()` 不能加 `revalidateTag`**：它在页面渲染期被调用（`admin/site/page.tsx`），而 `revalidateTag` 只能在 Server Action / Route Handler 里调用；且它落库值等于「行不存在」时的默认值，缓存旧结果仍正确。
  - 改 `actions/site.ts` 时注意：`themeRevalidate()` 的 8 处调用都必须在 `await writeThemeDoc()`（失败即 `return CONFLICT`）之后，**写入先提交再失效**，否则会把旧值重新缓存进去。
- **通用教训**：把「读配置」函数套进任何跨请求缓存前，先确认有没有夹带副作用——命中缓存时副作用不会执行，而这类 bug 表现为「某个 URL 拼错了」，极难归因到缓存。
- **缓存条目必须二进制安全**：`IncrementalCacheValue` 里的 `html` / `pageData` / `postponed` / `buffer` 是 Buffer，直接 `JSON.stringify` 会降级成 `{type:"Buffer",data:[…]}`，反序列化后不再是 Buffer，**页面渲染直接报错**。必须显式按 `{__bin: base64}` 打标递归编解码。
- **`unstable_cache` 会自己先 `JSON.stringify` 结果**（`node_modules/next/dist/server/web/spec-extension/unstable-cache.js` 第 24 行 `body: JSON.stringify(result)`，读回时第 182/261 行 `JSON.parse`）。**所以 `Date` 经 `unstable_cache` 一定变 ISO 字符串，与接不接 Redis 无关。** 好消息：本仓库 `timeAgo()`（`src/lib/format.ts:9`）与 `isOnline()`（`src/lib/online.ts:6`）都已经是 `Date | string` 签名，天然兼容。新增消费方不能再假定拿到 `Date`。
- **⚠️ `revalidatePath` 会连带失效 `unstable_cache` 条目（实测）**：直接改库插入新分类 → 页面不显示（说明缓存生效）；调 `revalidatePath("/browse")` → 立刻显示。含义：仓库里已有的 143 处 `revalidatePath` 会顺带清掉相关数据缓存 → **不会脏数据，但命中率低于预期，别按 100% 命中估收益**。
- **缓存条目是「全站一份」，失效判定按当前路由的 soft tag，且是 stale-while-revalidate（实测）**：`getCategories` 的键 = 函数源码 + keyParts，与路由无关。某路由 `revalidatePath` 后，该路由的下一次读取判定 stale → **先返回旧值、后台刷新**，所以同一秒内两次请求可能一新一旧。实测序列：stale 读（旧标签集）→ 下一次读（新标签集）。**这是预期行为，不是 bug，别去「修」。**
- **批次三已落地（2026-09-22）**：`getCategories`（标签 `categories` + TTL 600s）、`getTopTags` / `getRecentComments` / `getHomeStats` / `getTopCreators`（**只给 TTL、不挂标签**）。判断标准是「写入点能否枚举」——可枚举的挂标签（漏一处就是线上错误），不可枚举的（tag.count 每次上架自增、评论遍布前台、统计数字每次浏览都变）**只靠 TTL，因为挂标签却漏一处 = 永久脏数据，比诚实的近似危险得多**。
  - `getCategories`/`getTopTags` 是 **React `cache()` 作外层 + `unstable_cache` 作内层**：外层同页去重（Navbar/侧栏/首页板块常同页重复取），内层跨请求。
  - 写入侧只改 1 处：`actions/taxonomy.ts` 的 `revalidateAll()`。
  - **明确不缓存**（源码里都写了原因注释，别当遗漏「顺手补上」）：`getFeed` / `getRandomResourceIds`（都读 `viewerAuthed()` cookies，缓存会把游客 SFW 结果复用给所有人 = **NSFW 越权**，踩 D9 红线）、`getResourceDetail`（viewerId 进键）、`getRecommendations`、`getTagsBySlugs`（任意 slug 数组 → 键空间无界）、`getHomeSections`。**前两个必须先解耦 `viewerAuthed()` 才能谈缓存，那正是批次四要做的事。**
- **`queries.ts` 约 1415 行，远超 AGENTS.md 的 800 行硬上限**（批次三之前就已超标）。下一批建议先按领域拆分再动批次四。
