-- 资源类型扩展：新增 MUSIC（音乐）/ VIDEO（视频）两个大类
-- 目的：发布向导支持「在线挂载音视频」与「上传音视频文件」两种来源，音视频作为独立资源类型参与筛选与统计。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0003_resource_types_av.sql
--   2) 或：npx prisma db execute --file prisma/migrations/0003_resource_types_av.sql --schema prisma/schema.prisma
-- 说明：纯增量 DDL，只向既有枚举追加取值，不改动任何列、索引与存量行；可安全重复执行（IF NOT EXISTS）。
ALTER TYPE "ResourceType" ADD VALUE IF NOT EXISTS 'MUSIC';
ALTER TYPE "ResourceType" ADD VALUE IF NOT EXISTS 'VIDEO';
