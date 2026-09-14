-- 发布草稿箱：草稿快照表 + 用户级「自动保存草稿」开关。
-- 纯增量：只新建一张表、给 User 加一列（带默认值），不改动任何存量数据。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0004_resource_drafts.sql
--   2) 或开发期直接：npx prisma db execute --file prisma/migrations/0004_resource_drafts.sql --schema prisma/schema.prisma

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "autoSaveDraft" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "ResourceDraft" (
  "id"        TEXT NOT NULL,
  "ownerId"   TEXT NOT NULL,
  "type"      "ResourceType" NOT NULL,
  "title"     TEXT NOT NULL DEFAULT '',
  "payload"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResourceDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ResourceDraft_ownerId_updatedAt_idx"
  ON "ResourceDraft" ("ownerId", "updatedAt" DESC);

DO $$
BEGIN
  ALTER TABLE "ResourceDraft"
    ADD CONSTRAINT "ResourceDraft_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
