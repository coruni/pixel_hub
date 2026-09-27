-- 资源运营标记：置顶 / 精华（仅管理员可设，见 lib/actions/moderation.ts）
--
-- 纯增量、幂等：两列都可空，null = 未标记。已有行不受影响。
-- 字段与语义见 schema.prisma 的 Resource 模型注释；这里不建索引（理由同样写在那里）。
ALTER TABLE "Resource" ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);
ALTER TABLE "Resource" ADD COLUMN IF NOT EXISTS "featuredAt" TIMESTAMP(3);
