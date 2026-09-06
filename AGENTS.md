# Pixel Hub Agent Rules

本文件是本仓库的代理执行约束。目标是保护现有产品契约、视觉语言和用户未提交的工作，同时让新增实现贴合当前 Next.js 单体架构。

## 项目事实与事实来源

- 技术栈：Next.js 16.3.4（App Router）、React 19、TypeScript strict、Tailwind CSS v4、Prisma 6、PostgreSQL、Auth.js v5。
- 包管理器统一使用 `npm`，`package-lock.json` 是依赖锁定事实来源；Node.js 必须满足当前 Next.js 的 `>=20.9.0` 要求。
- 生产代码位于 `src/`，数据库模型位于 `prisma/schema.prisma`，公开静态资源位于 `public/`。
- 产品与数据模型参考 `DESIGN.md`；实际视觉规范以 `src/app/globals.css`、`src/lib/ui/cls.ts`、现有公共组件和当前生产页面为准。两者冲突时，视觉实现优先，除非任务明确要求重设计。
- `node_modules/next/dist/docs/` 是本仓库所用 Next.js 版本的 API 事实来源；修改 Next.js 代码前必须阅读相关章节。

## 工作区与工具

- 开始任务先运行 `git status --short --branch`，把已有修改视为用户工作；禁止覆盖、回退、格式化或提交无关文件。
- 搜索优先使用 `rg` / `rg --files`；缺失工具时可使用现有等价工具完成轻量检查。未经任务需要，不安装大体量运行时、缓存或依赖。
- 首次安装大体量依赖、运行时、缓存、数据库或容器数据前，必须让用户确认非系统盘路径；不得先写入系统盘再迁移。
- 编辑文本文件使用补丁式小范围修改；禁止 `git reset --hard`、`git checkout --`、强制推送或无确认的破坏性清理。
- 本地开发默认端口为 `3000`。启动前检查占用；已有可用实例时复用，不为“收尾”关闭用户正在验收的服务。

## 架构与兼容性

- 优先沿用 App Router、RSC、Server Actions、Prisma、现有 storage 抽象和组件目录；不要引入平行路由层、状态管理体系、CSS 框架或重复服务层。
- Server Component 优先，Client Component 仅承担浏览器状态和交互；不得无理由扩大 `"use client"` 边界。
- 保持路由 URL、search params、Server Action 签名、API 状态码/JSON 字段、Prisma 模型语义、环境变量名、存储 key、Auth 回调及公开导出兼容。
- 数据库变更必须同步更新 Prisma schema、迁移/初始化逻辑、seed 和相关验证；repair 只能非破坏性补齐，禁止自动删列、删索引或清数据。
- 上传、媒体、鉴权和审核路径必须继续执行服务端权限、大小、类型和安全校验；秘密、令牌、密码及客户数据不得写入代码、日志、截图或提交。
- 手写生产源码以约 600 行为治理目标、800 行为硬上限；达到硬上限或混合多个独立职责时先按领域拆分，禁止机械切文件或隐藏源码。

## Pixel Hub 视觉语言

### 颜色与主题

- 保持暖白/暖黑双主题、赤陶橙品牌色、暖灰中性色和点阵背景。优先使用 `background`、`surface`、`brand-*`、`neutral-*` 及 red/amber/emerald 等语义状态色。
- 新的全局颜色先在 `src/app/globals.css` 定义语义 token，再由 Tailwind utility 使用；禁止在页面和组件中散落无含义的十六进制颜色。
- 明暗主题通过 `<html class="dark">` 和 token 覆盖实现。除媒体遮罩等明确场景外，不为浅色/暗色分别硬编码两套组件。
- 所有新增或修改的页面必须同时检查浅色与暗色；前景、边框、占位符、悬浮、禁用和错误状态均需可辨识。

### 形状、字体与图标

- 全站使用直角像素语言：卡片、按钮、输入框、头像、标签和弹层默认 `rounded-none`。禁止引入圆角卡片、胶囊按钮、玻璃拟态或装饰性渐变。
- 阴影只用于需要层级分离的导航抽屉、弹层和悬浮卡；普通内容卡依靠边框与 surface 层级，不添加浮夸阴影。
- 品牌字体为 Fusion Pixel，回退链由 `globals.css` 统一维护；不要在页面内另设无关字体。
- 图标优先复用 `lucide-react` 和 `src/lib/nav-icons.ts`，保持方头、直角和 crisp rendering；禁止用 emoji、Unicode 符号、临时 SVG 或 CSS 图形代替正式图标。

### 布局与资源展示

- 站点导航和常规页面容器沿用 `mx-auto max-w-7xl px-4 sm:px-6`；资源详情沿用 `max-w-6xl`。新增页面不得发明不兼容的全局宽度和左右留白。
- 使用移动优先的弹性 `grid` / `flex`、`min-w-0`、`w-full` 和内容驱动高度；禁止只适配单一桌面宽度的固定大面积 px 布局。
- 资源网格默认移动端 2 列、`md` 3 列、`lg` 4 列；特殊页面可在保持卡片可读性的前提下显式覆盖。
- 侧栏在 `lg` 及以上进入右栏，窄屏按正文后的自然顺序展示；不得造成横向滚动、内容遮挡或固定侧栏挤压主栏。
- 资源卡保持图片优先：默认 3:4、`object-cover`、深色底部信息层、左上类型标识、标题与作者/分类摘要，并尽量保持整卡为单一可点击入口。
- 真实图片和已有资源优先；缺图使用现有 `CoverPlaceholder`。禁止用文本框、ASCII、随意拉伸或不匹配比例的素材伪装成正式资源。

### 导航、后台与状态

- 桌面顶部导航与移动端汉堡菜单必须复用现有 Navbar/MobileNav 结构；移动菜单打开时处理滚动锁定、Esc 关闭和路由后收起。
- 后台继续复用全站暖色 token、明暗主题、直角组件和 `max-w-7xl` 骨架；不要创建独立亮色工作台或套入另一套设计系统。
- 主操作使用品牌色；成功/下载可用 emerald，警告用 amber，危险操作用 red。状态不得只靠颜色表达，必须有文字、图标或结构提示。
- 加载、空、错误、禁用、成功和权限受限状态必须有明确反馈，并保持页面骨架稳定，避免长时间白屏或布局跳变。

## 可访问性与可读性红线

- 普通文本及重要控件文字与背景的对比度至少 4.5:1。当前白字/`brand-500` 和 `neutral-400`/浅色 surface 不达标，新增实现不得复制该组合；使用更深品牌阶或深色前景。
- 所有可交互控件必须有清晰的 `focus-visible` 状态；不得只写 `outline-none` 或仅改变 1px 边框而没有可见替代焦点。
- 移动端主要触控目标至少 44×44px；相邻操作留出足够间距。32px 图标按钮只能作为待治理存量，不得新增。
- 正文和重要操作文字不低于 12px；10–11px 仅限非关键徽标、排行号或辅助元数据，并必须验证 Fusion Pixel 下仍清晰。
- 表单必须有真实 label、说明和错误关联；图像必须有合适 alt，装饰图标使用 `aria-hidden`，图标按钮必须有可读名称。
- 交互、阅读顺序和弹层必须支持键盘；状态变化不得依赖 hover，移动端不得隐藏完成任务所需的信息。
- 动画保持短促克制，并为循环、位移或闪烁动画提供 `prefers-reduced-motion` 降级。
- 截图只能发现可见风险，不能据此宣称 WCAG 合规；涉及无障碍的任务还需键盘、缩放和语义检查。

## 文案与语言

- 当前产品语言为简体中文，`<html lang="zh-CN">`；沿用现有简洁、直接的社区语气和术语。
- 仓库尚无正式 i18n 基础设施。非本地化任务不得虚构 locale 目录或六语言同步要求；若明确引入国际化，必须先设计消息目录、fallback 和迁移方案。
- 面向用户的错误信息应可操作，不泄露内部异常、SQL、存储路径或凭据；日志可保留开发上下文，但不得直接展示给用户。

## 组件复用与设计变更流程

- 新增 UI 前先搜索 `src/components/`、`src/lib/ui/cls.ts` 和相似页面。按钮、输入框、头像、卡片、布局、加载器等优先复用，避免复制长 class 字符串。
- 重复样式达到多个调用点时收敛到最小公共组件或 class helper；内部模块从具体所有者导入，避免无边界 barrel 和循环依赖。
- 设计调整前先保存当前页面截图作为基线；只改任务指定范围，不顺带重设计邻近页面、文案、数据流或交互时机。
- 视觉验收至少覆盖 320、375、390、430、768、1024、1440px，并检查浅色/暗色、横向溢出、裁切、文本换行、筛选条、导航、侧栏和长文件名。

## 验证

- 文档或配置修改：运行 `git diff --check`，检查所有引用路径和命令真实存在，并确认无无关文件进入 diff。
- TypeScript/组件修改：至少运行 `npx tsc --noEmit`、`npm run lint` 和相关测试。
- 路由、布局、Client/Server 边界、全局 CSS、主题或构建配置修改：追加 `npm run build`。
- 跨核心流程修改：追加 `npm run test:smoke`；测试可能写数据库时，先确认使用隔离测试数据和可恢复策略。
- 视觉修改：使用实际运行页面截图验收，不以源码推断代替。每张截图需确认页面已加载完成、状态正确且没有裁切或错误页。
- 基线已有 warning/失败可以记录并保留，但不得新增；最终报告必须列出实际执行命令、结果和无法覆盖的证据限制。

## Git 交付

- 只暂存和提交本次任务拥有的文件；禁止使用 `git add -A` 把用户既有修改、日志、数据库或临时脚本带入提交。
- 提交前先 `git fetch` 并比较当前分支与远端。工作区有无关修改时，不自动 rebase、stash、丢弃或解决其冲突；远端分叉则停止并报告。
- 只有在验证通过且交付要求包含提交时才 commit/push；提交信息使用简洁单行中文概括目的。禁止强制推送。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
