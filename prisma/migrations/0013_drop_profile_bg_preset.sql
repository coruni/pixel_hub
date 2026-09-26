-- 兜底：官方背景库方案已撤销，删掉它当初加的 profileBgPreset 列。
--
-- 为什么要单列一条：0012 在被撤销前**短暂包含过**这个列，若某台环境已按那一版执行过，
-- 列会留在库里。Prisma schema 已不再映射它，留着不影响运行，但 `prisma db push` 会把它
-- 当成「多余列」提示。从未执行过旧版 0012 的环境跑这条也无害。
--
-- 幂等：DROP COLUMN IF EXISTS，列不存在时静默通过。
-- 应用方式：npx prisma db execute --file prisma/migrations/0013_drop_profile_bg_preset.sql --schema prisma/schema.prisma

ALTER TABLE "User" DROP COLUMN IF EXISTS "profileBgPreset";
