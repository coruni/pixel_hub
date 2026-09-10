-- 集中式限流 / 注册验证码表（对应 schema.prisma 的 RateLimitHit / RegisterCode）
-- 手工迁移（DB_SYNC=false，无 prisma migrate 流水线）：在目标 Postgres 执行本文件。
-- 生产 = Supabase：用 Supabase SQL Editor，或本地 `prisma db execute --stdin < 本文件`
--   （DATABASE_URL 指向 transaction pooler 时建议改用 DIRECT_URL 走 session 连接）；
--   本仓库本地直连的是生产 Supabase，勿在本地随意执行，请走 Supabase 控制台或明确确认后再跑。
-- 幂等：全部 IF NOT EXISTS，可重复执行。

CREATE TABLE IF NOT EXISTS "RateLimitHit" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "ts"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RateLimitHit_key_idx" ON "RateLimitHit" ("key");
CREATE INDEX IF NOT EXISTS "RateLimitHit_ts_idx"  ON "RateLimitHit" ("ts");

CREATE TABLE IF NOT EXISTS "RegisterCode" (
  "email"     TEXT NOT NULL,
  "code"      TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts"  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "RegisterCode_pkey" PRIMARY KEY ("email")
);

-- 可选：定期清理过期行（RateLimitHit 由代码惰性删除；RegisterCode 验证即焚）。
-- 低峰期可跑一次：DELETE FROM "RateLimitHit" WHERE "ts" < now() - interval '1 day';
--               DELETE FROM "RegisterCode" WHERE "expiresAt" < now();
