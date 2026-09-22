-- 创作者激励：贡献分 / PIX / 结算（设计见 creator-incentive-plan.md §4）。
-- 纯增量：只新建 10 张表 + 4 个枚举 + 索引与外键；不改任何存量表结构、不动存量数据。
-- 幂等：CREATE TABLE/INDEX 走 IF NOT EXISTS，枚举与外键走 DO ... duplicate_object 兜底，连执行两次无报错。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0006_creator_incentive.sql
--   2) 开发期直接：npx prisma db execute --file prisma/migrations/0006_creator_incentive.sql --schema prisma/schema.prisma
--
-- 注：下方 DDL 由 prisma migrate diff（--from-empty --to-schema-datamodel）生成后
-- 仅做幂等化改写（IF NOT EXISTS / DO 块），未手改任何列类型或约束名 —— 保证与 schema.prisma 零漂移。

DO $$
BEGIN
  CREATE TYPE "PointReason" AS ENUM ('PUBLISH', 'LIKE_RECEIVED', 'FAVORITE_RECEIVED', 'DOWNLOAD_RECEIVED', 'COMMENT_RECEIVED', 'FOLLOWER_GAINED', 'FEATURED', 'DAILY_LOGIN', 'ADMIN_ADJUST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "CoinReason" AS ENUM ('SETTLE', 'TIP_SENT', 'TIP_RECEIVED', 'WITHDRAW_FREEZE', 'WITHDRAW_PAID', 'WITHDRAW_REFUND', 'ADMIN_ADJUST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "WithdrawStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "IncentiveStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PAID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- UserPoint：**刻意不建 frozen 列** —— 计分冻结只认配置 risk.frozenUserIds（单一事实来源）。
CREATE TABLE IF NOT EXISTS "UserPoint" (
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPoint_pkey" PRIMARY KEY ("userId")
);

-- 兼容早期草稿版本（含 frozen BOOLEAN 列）：某个环境若已按那版建过表，这里非破坏性清掉，
-- 只删列、不动任何数据；列不存在时直接跳过，重复执行无副作用。
ALTER TABLE "UserPoint" DROP COLUMN IF EXISTS "frozen";

CREATE TABLE IF NOT EXISTS "PointLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" "PointReason" NOT NULL,
    "delta" INTEGER NOT NULL,
    "refId" TEXT,
    "balance" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CoinAccount" (
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "frozen" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeWithdrawn" INTEGER NOT NULL DEFAULT 0,
    "lifetimeTippedOut" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinAccount_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "CoinLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "kind" "CoinReason" NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "balance" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TipRecord" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "resourceId" TEXT,
    "coin" INTEGER NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TipRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WithdrawalRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coinAmount" INTEGER NOT NULL,
    "fiatFen" INTEGER NOT NULL,
    "rateSnapshot" INTEGER NOT NULL,
    "feeFen" INTEGER NOT NULL DEFAULT 0,
    "status" "WithdrawStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL,
    "accountInfo" TEXT NOT NULL,
    "note" TEXT,
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "rejectNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "payRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DownloadRecord" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "userId" TEXT,
    "ipHash" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "counted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DownloadRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RevenueEntry" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IncentivePeriod" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "status" "IncentiveStatus" NOT NULL DEFAULT 'DRAFT',
    "revenueFen" INTEGER NOT NULL DEFAULT 0,
    "ratePermille" INTEGER NOT NULL DEFAULT 0,
    "carryInFen" INTEGER NOT NULL DEFAULT 0,
    "poolFen" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "paidFen" INTEGER NOT NULL DEFAULT 0,
    "carryOutFen" INTEGER NOT NULL DEFAULT 0,
    "configSnapshot" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncentivePeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IncentivePayout" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "coin" INTEGER NOT NULL,
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "coinCredited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncentivePayout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserPoint_balance_idx" ON "UserPoint"("balance" DESC);

CREATE INDEX IF NOT EXISTS "UserPoint_level_idx" ON "UserPoint"("level");

CREATE INDEX IF NOT EXISTS "PointLog_userId_createdAt_idx" ON "PointLog"("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "PointLog_reason_createdAt_idx" ON "PointLog"("reason", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "PointLog_userId_reason_refId_key" ON "PointLog"("userId", "reason", "refId");

CREATE INDEX IF NOT EXISTS "CoinAccount_balance_idx" ON "CoinAccount"("balance" DESC);

CREATE INDEX IF NOT EXISTS "CoinLedger_userId_createdAt_idx" ON "CoinLedger"("userId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "CoinLedger_userId_kind_refId_key" ON "CoinLedger"("userId", "kind", "refId");

CREATE INDEX IF NOT EXISTS "TipRecord_toUserId_createdAt_idx" ON "TipRecord"("toUserId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "TipRecord_fromUserId_createdAt_idx" ON "TipRecord"("fromUserId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "TipRecord_resourceId_idx" ON "TipRecord"("resourceId");

CREATE INDEX IF NOT EXISTS "WithdrawalRequest_status_createdAt_idx" ON "WithdrawalRequest"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "WithdrawalRequest_userId_createdAt_idx" ON "WithdrawalRequest"("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "DownloadRecord_subjectKey_periodKey_idx" ON "DownloadRecord"("subjectKey", "periodKey");

CREATE INDEX IF NOT EXISTS "DownloadRecord_resourceId_periodKey_idx" ON "DownloadRecord"("resourceId", "periodKey");

CREATE INDEX IF NOT EXISTS "DownloadRecord_periodKey_idx" ON "DownloadRecord"("periodKey");

CREATE UNIQUE INDEX IF NOT EXISTS "DownloadRecord_resourceId_subjectKey_key" ON "DownloadRecord"("resourceId", "subjectKey");

CREATE INDEX IF NOT EXISTS "RevenueEntry_periodKey_idx" ON "RevenueEntry"("periodKey");

CREATE UNIQUE INDEX IF NOT EXISTS "IncentivePeriod_periodKey_key" ON "IncentivePeriod"("periodKey");

CREATE INDEX IF NOT EXISTS "IncentivePayout_userId_createdAt_idx" ON "IncentivePayout"("userId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "IncentivePayout_periodId_userId_key" ON "IncentivePayout"("periodId", "userId");

DO $$
BEGIN
  ALTER TABLE "UserPoint"
    ADD CONSTRAINT "UserPoint_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PointLog"
    ADD CONSTRAINT "PointLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CoinAccount"
    ADD CONSTRAINT "CoinAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CoinLedger"
    ADD CONSTRAINT "CoinLedger_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TipRecord"
    ADD CONSTRAINT "TipRecord_fromUserId_fkey"
    FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TipRecord"
    ADD CONSTRAINT "TipRecord_toUserId_fkey"
    FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TipRecord"
    ADD CONSTRAINT "TipRecord_resourceId_fkey"
    FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "WithdrawalRequest"
    ADD CONSTRAINT "WithdrawalRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "DownloadRecord"
    ADD CONSTRAINT "DownloadRecord_resourceId_fkey"
    FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "DownloadRecord"
    ADD CONSTRAINT "DownloadRecord_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "IncentivePayout"
    ADD CONSTRAINT "IncentivePayout_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "IncentivePeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "IncentivePayout"
    ADD CONSTRAINT "IncentivePayout_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
