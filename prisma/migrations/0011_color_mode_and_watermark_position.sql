-- 外观偏好 + 水印落点：给 User 增加 colorMode 与 watermarkPosition 两个非空枚举列。
-- 纯增量：只加 2 列，不动存量行语义 —— 存量用户自然落到默认值
-- （colorMode=SYSTEM 跟随系统；watermarkPosition=BOTTOM_RIGHT 保持历史右下角行为）。
--
-- 幂等：枚举用 DO 块吞掉 duplicate_object，列用 ADD COLUMN IF NOT EXISTS，连执行两次无报错。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0011_color_mode_and_watermark_position.sql
--   2) 开发期直接：npx prisma db execute --file prisma/migrations/0011_color_mode_and_watermark_position.sql --schema prisma/schema.prisma
--
-- 注：DDL 由 prisma migrate diff（--from-empty --to-schema-datamodel）生成后仅做幂等化改写，
-- 未手改任何列类型或约束名 —— 保证与 schema.prisma 零漂移。

DO $$ BEGIN
  CREATE TYPE "ColorMode" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "WatermarkPosition" AS ENUM ('TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT', 'TILE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "colorMode" "ColorMode" NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "watermarkPosition" "WatermarkPosition" NOT NULL DEFAULT 'BOTTOM_RIGHT';
