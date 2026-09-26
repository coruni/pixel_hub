-- 第三批结构性优化①：评论树加 rootId（根楼层指向自己），把「某根的全部后代」变成一条等值查询。
--
-- 动机：旧实现取某根的全部回复要在应用层逐层 BFS（每层一次 SQL 往返），
-- 深度靠 MAX_REPLY_DEPTH 兜底；换成 rootId 后单条 `WHERE rootId = ?` 即可。
--
-- 幂等、非破坏：只加列、加索引、回填数据，不改任何既有列或行数，可重复执行。
-- 应用方式：
--   psql "$DATABASE_URL" -f prisma/migrations/0016_comment_root_id.sql
--   或 npx prisma db execute --file prisma/migrations/0016_comment_root_id.sql --schema prisma/schema.prisma
--
-- 回填策略（与评论区的「根楼层」口径一致）：
--   · parentId IS NULL            → 根，rootId = id
--   · parentId 指向非 PUBLIC 楼层  → 也视作根（父被删后回复上移，见 comments-paging.ts）
--   · 其余                        → rootId = 父的 rootId（逐层下推）
--
-- 下推必须**自顶向下逐层**做（不能一次 UPDATE ... FROM parent 就算完）：
-- 同一层的父必须先填好，子才能继承。这里用递归 CTE 从根出发按层展开，天然满足顺序，
-- 并且带深度上限防御脏数据成环（正常评论树远浅于此）。

BEGIN;

ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "rootId" TEXT;

-- ① 根楼层：自己指向自己。含「父已非 PUBLIC」的上移情形。
UPDATE "Comment" c
SET "rootId" = c."id"
WHERE c."rootId" IS NULL
  AND (
    c."parentId" IS NULL
    OR EXISTS (
      SELECT 1 FROM "Comment" p
      WHERE p."id" = c."parentId" AND p."status" <> 'PUBLIC'
    )
  );

-- ② 从根出发逐层下推给后代。每轮只处理「父已有 rootId、自己还没有」的行，
--    REPEATABLE 的写法在 MySQL 里要循环，Postgres 用递归 CTE 一次到底。
WITH RECURSIVE tree AS (
  SELECT c."id", c."rootId", 1 AS depth
  FROM "Comment" c
  WHERE c."rootId" IS NOT NULL
  UNION ALL
  SELECT child."id", tree."rootId", tree.depth + 1
  FROM "Comment" child
  JOIN tree ON child."parentId" = tree."id"
  JOIN "Comment" parent ON parent."id" = child."parentId"
  WHERE child."rootId" IS NULL
    AND parent."status" = 'PUBLIC' -- 非公开楼层就地断链，其子会由 ① 的规则自成一棵
    AND tree.depth < 64            -- 脏数据成环兜底
)
UPDATE "Comment" c
SET "rootId" = tree."rootId"
FROM tree
WHERE c."id" = tree."id" AND c."rootId" IS DISTINCT FROM tree."rootId";

COMMIT;

-- 索引：取某根的全部公开后代，按时间正序（与 fetchRepliesByRoot 的取数口径一致）。
CREATE INDEX IF NOT EXISTS "Comment_rootId_status_createdAt_id_idx"
  ON "Comment" ("rootId", "status", "createdAt" ASC, "id" ASC);

CREATE INDEX IF NOT EXISTS "Comment_rootId_idx" ON "Comment" ("rootId");

-- 校验（可选，手工执行）：
--   SELECT count(*) FROM "Comment" WHERE "rootId" IS NULL;
--   应为 0 —— 非 0 说明存在环或不连通片段，需要人工排查后再决定是否继续启用 rootId 取数。
