-- 图片水印：给 User 增加「是否加水印」开关与自定义水印文字。
-- 纯增量：只加 2 列，都有默认值或可空，不改存量行语义、不动存量数据。
-- 幂等：ADD COLUMN IF NOT EXISTS，连执行两次无报错。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0008_image_watermark.sql
--   2) 开发期直接：npx prisma db execute --file prisma/migrations/0008_image_watermark.sql --schema prisma/schema.prisma
--
-- 注：DDL 由 prisma migrate diff（--from-empty --to-schema-datamodel）生成后仅做幂等化改写，
-- 未手改任何列类型或约束名 —— 保证与 schema.prisma 零漂移。

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "watermarkImages" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "watermarkText" TEXT;
