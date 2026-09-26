-- 第二批性能索引：覆盖前台资源流、评论分页/回复 BFS、通知筛选和下载配额统计。
--
-- 纯增量、幂等；不改变任何数据和查询语义。
-- 应用方式：
--   psql "$DATABASE_URL" -f prisma/migrations/0015_performance_indexes.sql
--   或 npx prisma db execute --file prisma/migrations/0015_performance_indexes.sql --schema prisma/schema.prisma
--
-- 说明：这些索引对应 prisma/schema.prisma 中同名 @@index；生产执行前仍建议用
-- EXPLAIN (ANALYZE, BUFFERS) 对照实际数据量确认命中情况。

CREATE INDEX IF NOT EXISTS "Resource_status_nsfw_publishedAt_createdAt_id_idx"
  ON "Resource" ("status", "nsfw", "publishedAt" DESC, "createdAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "Resource_status_nsfw_likeCount_publishedAt_id_idx"
  ON "Resource" ("status", "nsfw", "likeCount" DESC, "publishedAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "Resource_status_nsfw_downloadCount_publishedAt_id_idx"
  ON "Resource" ("status", "nsfw", "downloadCount" DESC, "publishedAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "Comment_resourceId_status_createdAt_id_idx"
  ON "Comment" ("resourceId", "status", "createdAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "Comment_parentId_status_createdAt_id_idx"
  ON "Comment" ("parentId", "status", "createdAt" ASC, "id" ASC);

CREATE INDEX IF NOT EXISTS "Notification_userId_type_createdAt_idx"
  ON "Notification" ("userId", "type", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "DownloadRecord_subjectKey_periodKey_counted_idx"
  ON "DownloadRecord" ("subjectKey", "periodKey", "counted");

CREATE INDEX IF NOT EXISTS "DownloadRecord_resourceId_periodKey_counted_idx"
  ON "DownloadRecord" ("resourceId", "periodKey", "counted");
