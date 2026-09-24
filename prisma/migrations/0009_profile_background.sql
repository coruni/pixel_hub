-- 个人主页背景：给 User 增加一张底图的存储 key。
-- 纯增量：只加 1 个可空列，不改存量行语义、不动存量数据（存量用户自然保持「无背景」）。
-- 幂等：ADD COLUMN IF NOT EXISTS，连执行两次无报错。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0009_profile_background.sql
--   2) 开发期直接：npx prisma db execute --file prisma/migrations/0009_profile_background.sql --schema prisma/schema.prisma
--
-- 注：DDL 由 prisma migrate diff（--from-empty --to-schema-datamodel）生成后仅做幂等化改写，
-- 未手改任何列类型或约束名 —— 保证与 schema.prisma 零漂移。

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileBgPcKey" TEXT;
