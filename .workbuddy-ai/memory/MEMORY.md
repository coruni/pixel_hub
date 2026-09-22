# Pixel Hub 项目长期笔记

## 验证与工具链

- **`_test/` 目录不存在、也未被 git 跟踪**（且不在 `.gitignore` 里），但 `package.json` 的 `test:smoke` / `test:admin-data` / `format` 都指向它。因此这三个脚本在此仓库**全是死链**，AGENTS.md 要求的 `npm run test:smoke` 无法执行。这是基线缺陷，不是改动造成的。要用测试前先确认 `_test/` 是否被补回来了。
- **`npm run build` 约需 10 分钟**，务必后台运行，不要用前台默认超时。
- **`npm run build` 会被本机 safe-delete 守卫拦下**：报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`，阈值 50 文件/轮，`next build` 清理 `.next/turbopack` 时正好卡在阈值上。这不是代码问题。放开方式：
  `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npm run build`
- 全仓库 `npm run lint` 基线**并非全绿**：`_seed-demo.js` 有 3 个 `no-require-imports` error，`prisma/seed-*.ts`、`admin/media/page.tsx`、`PublishForm.tsx`、`SiteSidebar.tsx` 有若干 unused-var warning。判断「是否新增问题」时先扣掉这些基线。
- `src/lib/upload-config.ts` 是**前后端共用**的纯数据/校验层（不依赖 server），客户端组件可以直接 import。

### 需要验证纯逻辑 / 客户端逻辑时

- 纯数据层（如 `upload-config.ts`）：`npx tsx <脚本>` 直接加载真实模块即可。
- **客户端模块（如 `upload-attachment-client.ts`）可以脱离浏览器验证**，做法见 `_tmp_upload_verify.mts`：本地 `node:http` 起模拟服务 + 一层 `XMLHttpRequest` shim + 包装 `globalThis.fetch` 补全相对路径。除 XHR 外全部用真实实现，不复刻业务逻辑。
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
