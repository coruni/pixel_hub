-- 版本历史功能下线：删掉 ResourceVersion 表。
--
-- 背景：资源早期有「发布新版本」这条独立路径（作者逐条追加版本 + 详情页渲染「版本历史」）。
-- 现在每个资源只有一份下载清单：GAME/ARTICLE/IMAGE 统一存 meta.downloads，
-- ResourceVersion 已无任何写入方（addVersionAction 与其 UI 入口一并移除），线上表为 0 行。
-- schema.prisma 已不再映射它，Prisma Client 里也拿不到这个 model。
--
-- 幂等：DROP TABLE IF EXISTS，表不存在时静默通过，重复执行无报错。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0018_drop_resource_version.sql
--   2) 开发期直接：npx prisma db execute --file prisma/migrations/0018_drop_resource_version.sql --schema prisma/schema.prisma
--
-- 注意：这是本仓库第一条**破坏性**迁移（此前 0013 只 DROP COLUMN）。执行前请确认
-- `SELECT count(*) FROM "ResourceVersion";` 为 0；不为 0 请先备份或改走人工转移。
-- 同时记得清掉代码侧残留的 index 引用（本次已同步删除该 model 的 @@index([resourceId, createdAt])）。

DROP TABLE IF EXISTS "ResourceVersion";
