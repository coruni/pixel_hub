-- 图片去重指纹：image upload 的「重复上传检测」（见 src/lib/media/checksum.ts）
--
-- Media.checksum 存**压缩前**原始上传字节的 sha256。图片会被 sharp 重编码，
-- Media.size 记的是压缩产物的字节数，撑不住「同名 + 同大小」那套判定；指纹取源字节才稳。
--
-- 纯增量、幂等：列可空（历史行留空，等价于「没指纹、不参与去重」），不改变任何现有语义。
-- 应用方式：
--   npx prisma db execute --file prisma/migrations/0021_media_checksum.sql --schema prisma/schema.prisma
--   或在 Supabase SQL Editor 里整段执行。
--
-- 索引对应 schema.prisma 中 Media 的 @@index([uploaderId, checksum])：
-- 去重查询是「uploaderId + checksum + kind + status」的等值组合，前缀命中即可。
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "checksum" TEXT;

CREATE INDEX IF NOT EXISTS "Media_uploaderId_checksum_idx" ON "Media" ("uploaderId", "checksum");
