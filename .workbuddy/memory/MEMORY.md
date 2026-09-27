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
- 暗色主题只覆盖 brand / neutral / red / amber 四组语义阶；**emerald / sky 等没有暗色覆盖**，
  在会跟随明暗的 surface 上当正文色用会糊（卡片封面那种固定深底才可以用亮阶）。
- 类型图标唯一事实来源：`src/components/resource/type-icon.tsx`（TYPE_ICON / TYPE_BADGE_TONE / TypeIcon）。

## 主页背景是「双槽」结构（2026-09-27 起）

- 桌面端 `User.profileBgPcKey` / 移动端 `User.profileBgMobileKey`，**各配一份遮罩**
  （`profileBgMask` / `profileBgMobileMask`）；`profileBgOnResource`、`profileBgGlobal`、
  等级门槛 `profile.bgMinLevel` **两槽共用**（语义：两张背景作为一个整体对外可见 / 不可见）。
- 两槽**不做跨槽回落**：只设了桌面端时移动端就是素底，不拿横图去填竖屏。
- 遮罩类唯一事实来源：`globals.css` 的 `.profile-bg-pc`（左右两条带，中段 alpha 0）/
  `.profile-bg-mobile`（**整张均匀半透明 alpha 0.5，不分区域**）；显示切换靠 Tailwind
  `hidden sm:block` / `sm:hidden`。移动端默认值同时存在于 `upload-config.ts` 的
  `PROFILE_BG_MOBILE_MASK_DEFAULT`，两处必须同步改。
- 设置页 `ProfileBgForm.tsx` 里 `BgSlotForm` 是两槽共用的槽组件；两槽的字段名映射收在
  `lib/actions/settings.ts` 的 `bgKeyData` / `bgMaskData` / `bgKeyOf`（Prisma update 是强类型的，
  不能拼动态键名）。
- **owner 压 global 的规则必须按断点成对写**：`:has()` 只看元素在不在 DOM 里、不看 display，
  一条不分断点的 `body:has([data-profile-bg-owner]) [data-profile-bg-global]` 会让
  「只设了桌面端」的用户在移动端把自己的全局背景也隐掉。现为 `-pc` / `-mobile` 两组属性 +
  两个互补媒体查询（`min-width: 40rem` 与 `width < 40rem`）。

