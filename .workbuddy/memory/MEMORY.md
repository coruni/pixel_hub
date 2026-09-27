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

## UI 语言

- 像素风 + Fusion Pixel + 点阵背景 + 赤陶橙 brand + 全站 `rounded-none`。
- 暗色主题只覆盖 brand / neutral / red / amber 四组语义阶；**emerald / sky 等没有暗色覆盖**，
  在会跟随明暗的 surface 上当正文色用会糊（卡片封面那种固定深底才可以用亮阶）。
- 类型图标唯一事实来源：`src/components/resource/type-icon.tsx`（TYPE_ICON / TYPE_BADGE_TONE / TypeIcon）。
