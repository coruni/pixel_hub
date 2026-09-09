// PostgreSQL 全文检索实现：pg_trgm（3-gram）GIN 索引 + ILIKE/LIKE 命中 + similarity 相关度排序。
//
// 适用性：
//   - Supabase / Neon / RDS 等托管 PG 默认允许启用 pg_trgm 扩展，无需新增服务或密钥；
//   - 中文按连续子串匹配（无需外部分词器），2 字以上关键词可走 GIN；单字查询退化顺序扫描（规模小可接受）；
//   - 搜索正确性由查询层交集兜底（见 search/index.ts 架构注释），引擎只管文本命中与排序。
//
// 数据模型（独立于 Prisma schema 的镜像表，db push 不会触碰）：
//   ResourceSearchDoc(resourceId PK→Resource.id ON DELETE CASCADE, searchText, updatedAt)
//   searchText 存「小写化的 title+summary+description」拼接，便于大小写不敏感命中走 GIN。
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { buildSearchText, type SearchDoc, type SearchEngine } from "./index";

const TABLE = "ResourceSearchDoc";

/** 幂等建表 + 扩展 + GIN 索引（进程内只执行一次；权限不足时抛错由调用方处理）。
 *  注意：Prisma $executeRaw 走 prepared statement，不能一次发多条命令，须逐条执行。 */
const ensureSteps: Prisma.Sql[] = [
  Prisma.sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`,
  Prisma.sql`CREATE TABLE IF NOT EXISTS ${Prisma.raw(`"${TABLE}"`)} (
  "resourceId" text PRIMARY KEY REFERENCES "Resource"(id) ON DELETE CASCADE,
  "searchText" text NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
)`,
  Prisma.sql`CREATE INDEX IF NOT EXISTS ${Prisma.raw(`"${TABLE}_searchText_idx"`)}
  ON ${Prisma.raw(`"${TABLE}"`)} USING GIN ("searchText" gin_trgm_ops)`,
];

export function createPgEngine(): SearchEngine {
  let ensured: Promise<void> | null = null;

  return {
    kind: "postgres",

    async ensure() {
      if (!ensured) {
        ensured = (async () => {
          for (const step of ensureSteps) await prisma.$executeRaw(step);
        })().catch((e) => {
          ensured = null;
          throw e;
        });
      }
      return ensured;
    },

    async search(q: string, { limit }: { limit: number }) {
      await this.ensure();
      const tokens = q
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => t.toLocaleLowerCase())
        .slice(0, 8);
      if (tokens.length === 0) return { ids: [], truncated: false };

      // 多关键词 AND 命中（searchText 已小写，用 LIKE 精确比较即可覆盖大小写）
      const like = (tok: string) =>
        Prisma.sql`"searchText" LIKE ${`%${escapeLike(tok)}%`}`;
      const cond =
        tokens.length === 1
          ? like(tokens[0])
          : Prisma.sql`(${Prisma.join(tokens.map(like), " AND ")})`;

      const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
SELECT "resourceId" AS "id"
FROM ${Prisma.raw(`"${TABLE}"`)}
WHERE ${cond}
ORDER BY similarity("searchText", ${q.toLocaleLowerCase()}) DESC, "updatedAt" DESC, "resourceId"
LIMIT ${limit}
`);
      return { ids: rows.map((r) => r.id), truncated: rows.length >= limit };
    },

    async upsert(docs: SearchDoc[]) {
      if (docs.length === 0) return;
      await this.ensure();
      const rows: Prisma.Sql[] = [];
      for (const d of docs) {
        const text = buildSearchText(d.title, d.summary, d.description).toLocaleLowerCase();
        if (!text) continue; // 标题/简介/正文全空时无检索价值，跳过
        rows.push(Prisma.sql`(${d.resourceId}, ${text}, ${d.updatedAt})`);
      }
      if (rows.length === 0) return;
      await prisma.$executeRaw(Prisma.sql`
INSERT INTO ${Prisma.raw(`"${TABLE}"`)} ("resourceId", "searchText", "updatedAt")
VALUES ${Prisma.join(rows, ", ")}
ON CONFLICT ("resourceId") DO UPDATE SET
  "searchText" = EXCLUDED."searchText",
  "updatedAt" = EXCLUDED."updatedAt"
`);
    },

    async remove(resourceIds: string[]) {
      if (resourceIds.length === 0) return;
      await prisma.$executeRaw(Prisma.sql`
DELETE FROM ${Prisma.raw(`"${TABLE}"`)}
WHERE "resourceId" IN (${Prisma.join(resourceIds.map((id) => Prisma.sql`${id}`), ", ")})
`);
    },
  };
}

/** 转义 LIKE 通配符：用户输入含 %/_ 按字面处理（与旧 contains 的子串语义一致且更稳）。 */
function escapeLike(tok: string): string {
  return tok.replace(/[\\%_]/g, (c) => `\\${c}`);
}
