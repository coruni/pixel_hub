# Pixel Hub 项目长期记忆

## 存储层约定

- 远端对象存储（s3 / chevereto）**必须显式写 ContentType**：S3 不按扩展名猜类型，缺省落成 `binary/octet-stream`，直链访问图片会变成下载。
- MIME 判定统一走 `src/lib/storage/mime.ts`（`resolveContentType(declared, key)`）：优先调用方声明、做形状校验与危险类型黑名单，回退 key 扩展名。**不要在各驱动/页面里另写扩展名映射表**。
- 新增上传落盘点时，`saveFile(key, buf, contentType)` 的第三参应传真实 MIME（后台配置输出格式用 `outputMime(cfg.format)`，客户端来源用 `file.type`）。
- 存量对象类型补正：`npm run s3:fix-content-type`（默认预演，`--apply` 生效）。
