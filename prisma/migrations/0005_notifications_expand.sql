-- 通知能力补全：站内开关 + 点赞聚合计数 + 安全类通知类型。
-- 纯增量：加列（带默认值）/ 加枚举值，不改动任何存量数据。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0005_notifications_expand.sql
--   2) 或开发期直接：npx prisma db execute --file prisma/migrations/0005_notifications_expand.sql --schema prisma/schema.prisma

-- 新增枚举值须独立于后续语句的事务语义之外使用；本批只加值不使用，安全。
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SECURITY';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inAppNotifyLike" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inAppNotifyComment" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inAppNotifyFollow" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inAppNotifySystem" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "count" INTEGER NOT NULL DEFAULT 1;
