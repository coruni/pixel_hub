-- 装饰：昵称特效色 + 官方背景库。
-- 纯增量：只加 2 个可空列，不改存量行语义、不动存量数据（存量用户自然保持「默认色 / 无预设背景」）。
-- 幂等：ADD COLUMN IF NOT EXISTS，连执行两次无报错。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0012_decorations.sql
--   2) 开发期直接：npx prisma db execute --file prisma/migrations/0012_decorations.sql --schema prisma/schema.prisma
--
-- 注：DDL 由 prisma migrate diff（--from-empty --to-schema-datamodel）生成后仅做幂等化改写，
-- 未手改任何列类型或约束名 —— 保证与 schema.prisma 零漂移。
--
-- 不加外键/枚举：两个值都是 lib/decorations.ts 里的字符串 key。用枚举会把「清单是源码资产」
-- 这条事实复制到数据库里，改一次清单就要动一次迁移。

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileBgPreset" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "nameColor" TEXT;
