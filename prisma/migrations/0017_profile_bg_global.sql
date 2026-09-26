-- 主页背景「全局显示」开关。
-- 纯增量：只加 1 个带默认值的非空列，不改存量行语义、不动存量数据
-- （存量用户自然保持 false = 维持原有「只在个人主页 + 资源详情页铺设」行为）。
-- 幂等：ADD COLUMN IF NOT EXISTS，连执行两次无报错。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0017_profile_bg_global.sql
--   2) 开发期直接：npx prisma db execute --file prisma/migrations/0017_profile_bg_global.sql --schema prisma/schema.prisma
--   3) 或直接 npx prisma db push（本仓库已验证可用，列名与 schema.prisma 零漂移）
--
-- 语义：
--   profileBgGlobal = true  → 背景铺到「除后台外的所有页面」（全站自见 + 其他访客也可见）
--   profileBgGlobal = false → 维持原行为，只在个人主页 + 资源详情页（受 profileBgOnResource 控制）
--   与 profileBgOnResource 正交：后者只管「其他访客在资源详情页能不能看到」，
--   未勾选时作者本人仍能看到自己的背景。

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileBgGlobal" BOOLEAN NOT NULL DEFAULT false;
