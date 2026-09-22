-- 支付（易支付 Epay）：订单 + 收支台账（设计见 payment-plan.md §4）。
-- 纯增量：只新建 2 张表 + 3 个枚举 + 索引与外键；不改任何存量表结构、不动存量数据。
-- 幂等：CREATE TABLE/INDEX 走 IF NOT EXISTS，枚举与外键走 DO ... duplicate_object 兜底，连执行两次无报错。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0007_payment.sql
--   2) 开发期直接：npx prisma db execute --file prisma/migrations/0007_payment.sql --schema prisma/schema.prisma
--
-- 注：下方 DDL 由 prisma migrate diff（--from-empty --to-schema-datamodel）生成后
-- 仅做幂等化改写（IF NOT EXISTS / DO 块），未手改任何列类型或约束名 —— 保证与 schema.prisma 零漂移。

DO $$
BEGIN
  CREATE TYPE "OrderKind" AS ENUM ('SPONSOR', 'QUOTA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'CLOSED', 'REFUNDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "LedgerKind" AS ENUM ('COST_SERVER', 'COST_STORAGE', 'COST_DOMAIN', 'COST_OTHER', 'INCOME_SPONSOR', 'INCOME_AD', 'INCOME_OTHER', 'WITHDRAWAL_PAID', 'REFUND_SPONSOR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 支付订单：唯一事实来源。outTradeNo 用 cuid（不可预测）—— 防枚举、防伪造回调。
-- notifyRaw 落库前由 payment.ts 剔除 key/sign，**永不明文存密钥**。
CREATE TABLE IF NOT EXISTS "PaymentOrder" (
    "id" TEXT NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "kind" "OrderKind" NOT NULL,
    "userId" TEXT,
    "amountFen" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "periodKey" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "epayTradeNo" TEXT,
    "payType" TEXT,
    "notifyRaw" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedFen" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- 收支台账：只记真钱进出（收入 / 成本 / 提现打款）。
-- 结算分配（向创作者入账 PIX）不进这张表 —— 它只抬升代币负债，钱还没出去。
CREATE TABLE IF NOT EXISTS "LedgerEntry" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "direction" TEXT NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "note" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentOrder_outTradeNo_key" ON "PaymentOrder"("outTradeNo");
CREATE INDEX IF NOT EXISTS "PaymentOrder_status_createdAt_idx" ON "PaymentOrder"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentOrder_kind_periodKey_idx" ON "PaymentOrder"("kind", "periodKey");
CREATE INDEX IF NOT EXISTS "PaymentOrder_kind_status_paidAt_idx" ON "PaymentOrder"("kind", "status", "paidAt");
CREATE INDEX IF NOT EXISTS "PaymentOrder_userId_idx" ON "PaymentOrder"("userId");

CREATE INDEX IF NOT EXISTS "LedgerEntry_periodKey_direction_idx" ON "LedgerEntry"("periodKey", "direction");
CREATE INDEX IF NOT EXISTS "LedgerEntry_createdAt_idx" ON "LedgerEntry"("createdAt" DESC);
-- 幂等闸门：同一单据同一科目只可能有一条台账（refId 为空的手工录入不受约束，NULL 互不相等）
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_kind_refId_key" ON "LedgerEntry"("kind", "refId");

DO $$
BEGIN
  ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
