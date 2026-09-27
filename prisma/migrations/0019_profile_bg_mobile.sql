-- 个人主页背景的「移动端槽位」：独立一张竖图 + 独立遮罩形状。
-- 纯增量：只加 2 个可空列，不改存量行语义、不动存量数据
-- （存量用户自然保持「移动端没有背景」，个人主页在窄屏下仍是素底，与加列前完全一致）。
-- 幂等：ADD COLUMN IF NOT EXISTS，连执行两次无报错。
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0019_profile_bg_mobile.sql
--   2) 开发期直接：npx prisma db execute --file prisma/migrations/0019_profile_bg_mobile.sql --schema prisma/schema.prisma
--   3) 或直接 npx prisma db push（本仓库已验证可用，列名与 schema.prisma 零漂移）
--
-- 【为什么另开一列而不是复用 profileBgPcKey】
--   横图与竖图的构图不同：同一张 16:10 的横图在竖屏被 cover 会裁掉左右大半，主体常常直接消失。
--   分成两列后两端各自上传、互不干扰，也不做跨槽回落（只设桌面端时移动端就是没背景，
--   而不是硬把横图塞进竖屏里 —— 那样看着像坏了，还不如素底）。
--
-- 【哪些东西是共用的】
--   profileBgOnResource（资源页对他人可见）、profileBgGlobal（全局显示）、
--   以及等级门槛 profile.bgMinLevel（激励配置）：三个都**管两个槽位**，不另开列。
--   语义是「这两张背景作为一个整体对外可见/不可见」，而不是两张各自一套开关。
--
-- DDL 由 prisma migrate diff（--from-empty --to-schema-datamodel）生成后仅做幂等化改写，
-- 未手改任何列类型或约束名 —— 保证与 schema.prisma 零漂移。

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileBgMobileKey" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileBgMobileMask" TEXT;
