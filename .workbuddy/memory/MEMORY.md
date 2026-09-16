# Pixel Hub —— 长期项目约定

## 图片压缩（重要，改动前必读）
- 所有服务端图片压缩必须走 `src/lib/media/compress.ts` 的 `compressWith()`，禁止在业务代码里直接写 `.webp()/.jpeg()/.png()`。
- alpha 通道规则：webp 锁定 `alphaQuality: 100`；png `quality<100` 用 `palette: true` 量化（带 alpha 支持）、`quality=100` 走无损；jpg 无 alpha，必须先 `flatten({ background: "#ffffff" })` 合成白底再编码（否则透明区域变黑）。
- 压缩参数来源：`SiteSetting["uploadLimits"]` 的 `imageFormat`（webp/jpg/png，默认 webp）与 `imageQuality`（1..100，默认 82），后台入口 `/admin/uploads` 的「图片压缩」区块。
- 缩略图质量 = 主图质量 − 8（下限 40，默认 82 → 74），保持与原硬编码值一致。
- 落盘 key 的扩展名必须与输出格式一致（local/s3/chevereto 驱动按 key 扩展名识别 content-type）。
- 回归验证：`npx tsx _test/compress-alpha.ts`（断言 webp/png 保留 alpha、jpg 合白底、缩略图降档）。

## ImageViewer（src/components/ui/ImageViewer.tsx）
- 平移能力按「可平移空间」（`panBounds`/`canPan`）判定，不用 `zoom > 1` 当代理条件：缩小时同样可拖动。
- 位移必须在 `applyZoom`/`rotateBy` 后重新夹取，否则放大拖动后再缩回会停在偏移位置。
- react-hooks v7 的 immutability 规则不允许在 useCallback/useEffect 中写 `useRef.current`（仅 useLayoutEffect 内允许），需要随渲染变化的镜像值优先直接读 state。

## UI 文案（tip / 提示）取舍
- 判断标准：只讲「怎么操作」、而该操作已由可见控件表达的文案＝多余 tip，不写（如「点击卡片进入填写」「向下滚动加载更多」「悬停查看数值」「点保存上传」）。
- 必写的四类：配置含义、约束（尺寸/格式/上限）、状态反馈（加载/空/错误/权限）、行为后果（保存后会发生什么）。
- 图标按钮的 `title` 是**无障碍名称**，属必留项，不要当 tip 删除，否则违反 a11y 红线。
- 现有写法沿用：admin 表单的 `hint` 字段、settings 页 `sectionHint`（`mb-4 mt-1 text-xs text-neutral-400`）、admin 页首说明框（`rounded-none border border-brand-200 bg-surface px-4 py-3 text-xs leading-5 text-neutral-500`）。
- 无限滚动哨兵（`feed/FeedInfinite.tsx`）：删掉提示文案后容器必须保留高度（现为 `mt-6 flex h-8 items-center justify-center`），否则 IntersectionObserver 目标塌陷。

## CSS 层叠层与「无层优先」（踩过的坑）
- `globals.css` 里写在 `@import "tailwindcss"` **之后**的规则是无层的；Tailwind 工具类落在 `@layer utilities`。层叠层序中**无层优先于任何分层**，这一层判断在特异性之前生效。
- 与全局无层规则冲突时（典型：`* { scrollbar-width: thin }`），Tailwind 的任意值写法（中括号）会被静默压掉。解法：在 `globals.css` 补一个无层普通 class（现有 `.scrollbar-none`），不要指望 JSX 里的任意值类。
- 另外：`globals.css` 的注释里也不要写出中括号类名原样（Tailwind 会扫描注释当候选类，凭空生成一条无用规则）。
- 横向滚动 + 下划线 tab：`overflow-x-auto` 会把 overflow-y 算成 auto 并裁掉自身溢出，所以 `-mb-px` 必须挂在滚动容器上，挂按钮上会被裁掉 1px。
