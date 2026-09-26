# Pixel Hub 项目长期记忆

## 存储层约定

- 远端对象存储（s3 / chevereto）**必须显式写 ContentType**：S3 不按扩展名猜类型，缺省落成 `binary/octet-stream`，直链访问图片会变成下载。
- MIME 判定统一走 `src/lib/storage/mime.ts`（`resolveContentType(declared, key)`）：优先调用方声明、做形状校验与危险类型黑名单，回退 key 扩展名。**不要在各驱动/页面里另写扩展名映射表**。
- 新增上传落盘点时，`saveFile(key, buf, contentType)` 的第三参应传真实 MIME（后台配置输出格式用 `outputMime(cfg.format)`，客户端来源用 `file.type`）。
- 存量对象类型补正：`npm run s3:fix-content-type`（默认预演，`--apply` 生效）。

## 仓库约定

- `.workbuddy-ai/memory/` 在本仓库是**被 git 跟踪的**（用户会把记忆文件一并提交），不是忽略目录；写记忆 = 产生待提交改动。
- 面向用户的更新公告（`CHANGELOG-*.md`）是临时产物，发完即删（09-15~09-25 那版已在 09-25 上午删除）。需要时重新生成，不要在仓库里长期留存。
- 下载链路：`/api/dl` 对 S3 对象直接 302 到对象 URL（`response-content-disposition` 保留原文件名），服务端不转发字节；改动下载行为时注意这条。

## 装饰体系约定

- 装饰清单（昵称特效色）与**每款的解锁等级**写在 `src/lib/decorations.ts`，**不进后台配置** —— 昵称色值必须是 Tailwind 字面量类名，后台无法新增，做成配置只会得到假选项。后台只有 `incentive.decoration.nicknameEnabled` 一个总开关。（官方背景库曾短暂存在，已按用户要求撤销，清理见 `0013_drop_profile_bg_preset.sql`。）
- 装饰一律**只按等级门槛开放、不消耗贡献分**。贡献分是荣誉层（只增不减），扣它 = 掉级，会连带把已达标的装饰一起打回锁定；要「消费感」走 PIX（资产层）。
- 昵称色必须维护**两套值**：`--nick-*` 跟随明暗主题（浅底页面用），`--nick-*-bright` 固定亮阶（资源卡黑条、首页大图用）。两套亮度区间互斥，不能合并成一套。
- 新增一类装饰的固定路径：清单加进 `decorations.ts` → `User` 加字段 + 幂等迁移 → Server Action（服务端重算门槛）→ 设置页选择器 → 前台渲染。若涉及新的配置分组，必须同步 `IncentiveManager.tsx` 的 `GROUPS` 常量，否则保存任意其他设置时新分组会被 zod default **静默重置**。
- **昵称一律走 `components/ui/Nickname`（服务端）或 `NicknameText`（客户端），不要直接调 `decorations.ts` 的 `nameColorClass` / `nameColorBrightClass`**。组件对外暴露 `tone`（`light` 跟随主题 / `dark` 固定深底），由渲染点声明底色——两套色值亮度区间互斥，选错不报错、只会静默对比度不足，这正是当初散在 8 处时最容易出的错。服务端渲染点用 `Nickname`（自己读开关，别手传 `enabled`）；只有「已读到开关、还要顺手转交给别的子组件」时才用 `NicknameText` 显式传。客户端组件引 `Nickname` 会直接编译失败，这是有意设的护栏。
- 组件化昵称的一个副作用：昵称变成子元素后，**父级 `hover:text-*` 不再生效**（颜色是子元素自己的 `color`），hover 类必须写进 `NicknameText` 的 `className`。
