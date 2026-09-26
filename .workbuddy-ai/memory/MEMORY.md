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

- 装饰清单（昵称特效色 / 官方背景预设）与**每款的解锁等级**写在 `src/lib/decorations.ts`，**不进后台配置** —— 昵称色值必须是 Tailwind 字面量类名、官方背景是随仓库发布的静态资源，两者后台都无法新增。后台只有两个总开关：`incentive.decoration.nicknameEnabled` / `bgPresetEnabled`。
- 装饰一律**只按等级门槛开放、不消耗贡献分**。贡献分是荣誉层（只增不减），扣它 = 掉级，会连带把已达标的装饰一起打回锁定；要「消费感」走 PIX（资产层）。
- 昵称色必须维护**两套值**：`--nick-*` 跟随明暗主题（浅底页面用），`--nick-*-bright` 固定亮阶（资源卡黑条、首页大图用）。两套亮度区间互斥，不能合并成一套。
- 新增一类装饰的固定路径：清单加进 `decorations.ts` → `User` 加字段 + 幂等迁移 → Server Action（服务端重算门槛）→ 设置页选择器 → 前台渲染。若涉及新的配置分组，必须同步 `IncentiveManager.tsx` 的 `GROUPS` 常量，否则保存任意其他设置时新分组会被 zod default **静默重置**。
