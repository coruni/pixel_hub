-- 首页板块可见性扩展：设备端可见（visibleOn）+ 仅登录可见（requireAuth）
-- 应用方式（二选一）：
--   1) 手动执行：psql "$DATABASE_URL" -f prisma/migrations/0002_home_section_visibility.sql
--   2) 或开发期直接：npx prisma db push   （非破坏性，仅新增两列并设默认值）
ALTER TABLE "HomeSection" ADD COLUMN "visibleOn" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "HomeSection" ADD COLUMN "requireAuth" BOOLEAN NOT NULL DEFAULT false;
