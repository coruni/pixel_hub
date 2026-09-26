-- 个人主页背景遮罩：让用户自定义自己背景的 mask-image 形状。
-- 纯增量：只加 1 个可空列，不改存量行语义、不动存量数据（存量用户自然保持「用内置默认遮罩」）。
-- 幂等：ADD COLUMN IF NOT EXISTS，连执行两次无报错。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0014_profile_bg_mask.sql
--   2) 开发期直接：npx prisma db execute --file prisma/migrations/0014_profile_bg_mask.sql --schema prisma/schema.prisma
--
-- 注：DDL 由 prisma migrate diff（--from-empty --to-schema-datamodel）生成后仅做幂等化改写，
-- 未手改任何列类型或约束名 —— 保证与 schema.prisma 零漂移。
--
-- 存整条 CSS 值而不是几个数值：形状自由度全在渐变里（方向、stop 数量、缓动），
-- 拆成列等于把 CSS 的表达能力截断。安全性由 upload-config.ts 的 safeBgMask() 在**渲染前**收口
-- （只放行渐变写法，挡掉 url() / var() 等外部请求与注入面），不靠数据库约束。

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileBgMask" TEXT;
