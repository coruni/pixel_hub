-- Media.size 由 INT4 放宽到 DOUBLE PRECISION
--
-- 【为什么】Media.size 记的是落盘字节数。后台上限 attachmentMaxMb 可配到 250GiB
-- （OneDrive 单文件上限，见 upload-config.ts 的 MAX_ATTACHMENT_MB），无云盘时的流式直传
-- 也按同一个上限放行 —— 但旧列是 INT4，上限只有 2147483647（≈2GiB）。
--
-- 超限时的表现很隐蔽：**不是写入报错，而是上传入口的去重查询先炸**。
-- attachment / attachment.session / attachment.stream 三条通道都要先按「同名 + 同大小」
-- 查一遍已完成的 Media，于是：
--   prisma.media.findFirst({ where: { ..., size: 2544241382 } })
--   → ConnectorError(QueryError(ToSql(3), ConversionError("Unable to fit integer value
--      '2544241382' into an INT4 (32-bit signed integer).")))
-- 表现为 2GiB 以上的文件怎么传都是 500，且客户端会重试（日志里同一段报四遍）。
--
-- 【为什么是 DOUBLE PRECISION 而不是 BIGINT】Prisma 对 bigint 列返回 JS BigInt，
-- 而 size 会进 JSON 响应（三个上传路由都回 `size`）、进 Map（download-size.ts）、
-- 参与算术与展示（admin 概览、桶用量求和）—— JSON.stringify(BigInt) 直接抛错，
-- 漏转任何一处都是运行时崩。double precision 能精确表示所有 ≤2^53 的整数（≈9PB），
-- 本站任何上限都碰不到，且 Prisma 一侧仍是 number，零代码改动。
--
-- 【安全性】INT4 → DOUBLE PRECISION 是 widening cast，不丢数据、不改语义；
-- 与 0021 一样纯增量。列保持可空（原有 NULL 行不受影响）。
--
-- 应用方式：
--   npx prisma db execute --file prisma/migrations/0022_media_size_widen.sql --schema prisma/schema.prisma
--   或在 Supabase SQL Editor 里整段执行。
--
-- ⚠️ 只跑这条 SQL **不足以**恢复上传：Prisma Client 是在**应用侧**做 Int32 编码检查的，
-- 旧镜像的 client 依旧会把大值当 Int32 拒掉。必须连同新代码一起重建镜像（npm run build
-- 里的 `prisma generate` 会按新 schema 产出 client）。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Media'
      AND column_name = 'size'
      AND data_type <> 'double precision'
  ) THEN
    ALTER TABLE "Media"
      ALTER COLUMN "size" TYPE DOUBLE PRECISION USING "size"::double precision;
  END IF;
END $$;
