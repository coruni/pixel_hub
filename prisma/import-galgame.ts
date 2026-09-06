/* eslint-disable @typescript-eslint/no-explicit-any */
// galgame → CMS（Pixel Hub）结构转换导入脚本
// ---------------------------------------------------------------------------
// 数据源：本地临时还原的 galgame 库（由 galgame_20260906180618tubyt.sql 经
//   pg_restore 还原到 localhost:5433，trust 鉴权）。galgame 是另一套应用 schema，
//   与本 CMS 不同；本脚本做跨 schema 映射。
//
// 目标：当前 DATABASE_URL 指向的 CMS 库（本项目 Supabase）。
//
// 用法：npx tsx prisma/import-galgame.ts
// 幂等：资源按 slug 已存在则跳过；标签按 name 复用；可安全重复运行（只新增不覆盖）。
//
// 映射取舍（遵循用户要求 + 沿用 import-coshub.ts 约定）：
//   - Game → Resource(type=GAME, status 按源 PUBLISHED/DRAFT 映射)
//   - 分类统一用本项目「游戏」分类（slug=games，已存在则复用）
//   - nsfw：源 Game.nsfw=true → Resource.nsfw=true（用户要求）
//   - 用户数据不迁移；资源归属到本项目 ADMIN 账号
//   - coverImage → Media(kind=COVER, storageKey=外链)；screenshots → Media(GALLERY)
//   - DownloadLink → Resource.externalUrl + GameMeta(version/size/platforms/lang)
//     其余下载地址以 Markdown 列表写入 description「下载地址」区（不丢数据）
//   - Tag / _GameTags → Tag / TagOnResource
// @ts-expect-error pg 未随包提供类型声明，本脚本仅经 tsx 运行时执行
import pg from "pg";
import { Prisma, ResourceStatus } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { slugify } from "../src/lib/slug";

const SRC = {
  host: process.env.GALGAME_HOST ?? "localhost",
  port: Number(process.env.GALGAME_PORT ?? 5433),
  user: "postgres",
  database: "galgame",
  ssl: false,
};

const mimeOf = (url: string): string => {
  const u = (url.split("?")[0] || "").toLowerCase();
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".gif")) return "image/gif";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg"; // 外链（如 pan 分享）无扩展名时兜底
};
const fileNameOf = (url: string) => {
  try {
    const p = url.split("?")[0].split("#")[0];
    const seg = p.split("/").pop() || "";
    return seg ? decodeURIComponent(seg).slice(0, 120) : "image";
  } catch {
    return "image";
  }
};
const num = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? v : 0);
const fmtDate = (d: Date | null) =>
  d instanceof Date ? d.toISOString().slice(0, 10) : "";

const statusMap: Record<string, ResourceStatus> = {
  PUBLISHED: "PUBLISHED",
  DRAFT: "DRAFT",
  PENDING: "PENDING",
  ARCHIVED: "REMOVED",
  REJECTED: "REJECTED",
};

async function getTag(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const clean = name.trim();
  const exist = await tx.tag.findUnique({ where: { name: clean } });
  if (exist) return exist.id;
  let slug = slugify(clean) || "tag";
  while (await tx.tag.findUnique({ where: { slug } })) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  }
  const t = await tx.tag.create({ data: { name: clean, slug, count: 0 } });
  return t.id;
}

function buildDescription(
  g: Record<string, any>,
  links: Record<string, any>[],
): string {
  const parts: string[] = [];
  if (g.description && String(g.description).trim()) parts.push(String(g.description).trim());
  const info: string[] = [];
  if (g.originalTitle) info.push(`- 原名：${g.originalTitle}`);
  if (g.developer) info.push(`- 厂商：${g.developer}`);
  if (g.publisher) info.push(`- 发行：${g.publisher}`);
  if (g.releaseDate) info.push(`- 发行日期：${fmtDate(g.releaseDate)}`);
  if (Array.isArray(g.language) && g.language.length) info.push(`- 语言：${g.language.join("、")}`);
  if (Array.isArray(g.platform) && g.platform.length) info.push(`- 平台：${g.platform.join("、")}`);
  if (Array.isArray(g.aliases) && g.aliases.length) info.push(`- 别名：${g.aliases.join("、")}`);
  if (info.length) {
    parts.push("## 作品信息");
    parts.push(info.join("\n"));
  }
  if (links.length) {
    parts.push("## 下载地址");
    for (const l of links) {
      const meta = [l.platform, l.size].filter(Boolean).join(" / ");
      parts.push(`- [${l.label || "下载"}](${l.url})${meta ? ` （${meta}）` : ""}`);
    }
  }
  return parts.join("\n\n");
}

async function main() {
  // 1) 读源（galgame 临时库）
  const src = new pg.Client(SRC);
  await src.connect();
  const games = (await src.query(`SELECT * FROM "Game" ORDER BY "createdAt"`)).rows;
  const dls = (await src.query(`SELECT * FROM "DownloadLink" ORDER BY "createdAt"`)).rows;
  const tags = (await src.query(`SELECT * FROM "Tag"`)).rows;
  const gt = (await src.query(`SELECT * FROM "_GameTags"`)).rows;
  await src.end();

  const dlByGame = new Map<string, Record<string, any>[]>();
  for (const l of dls) {
    const arr = dlByGame.get(l.gameId) ?? [];
    arr.push(l);
    dlByGame.set(l.gameId, arr);
  }
  const tagById = new Map<string, Record<string, any>>(tags.map((t: Record<string, any>) => [t.id, t]));
  const gtByGame = new Map<string, string[]>();
  for (const r of gt) {
    const arr = gtByGame.get(r.A) ?? [];
    arr.push(r.B);
    gtByGame.set(r.A, arr);
  }

  // 2) 目标锚点：游戏分类 + ADMIN 作者
  const gameCat = await prisma.category.findUnique({ where: { slug: "games" } });
  if (!gameCat) throw new Error("未找到「游戏」分类（slug=games），请先确认分类存在");
  const author = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!author) throw new Error("未找到 ADMIN 账号，无法归属资源");

  const stats = {
    resources: 0,
    resourceSkipped: 0,
    media: 0,
    tags: 0,
    tagLinks: 0,
  };

  await prisma.$transaction(
    async (tx) => {
      for (const g of games) {
        const exist = await tx.resource.findUnique({ where: { slug: g.slug } });
        if (exist) {
          stats.resourceSkipped++;
          continue;
        }
        const links = dlByGame.get(g.id) ?? [];
        const primary = links[0];

        const summary =
          (g.intro && String(g.intro).trim()) ||
          [g.developer, g.publisher].filter(Boolean).join(" · ") ||
          "Galgame 资源";
        const description = buildDescription(g, links);
        const status = statusMap[g.status] ?? "PENDING";

        const meta = JSON.stringify({
          version: primary?.version || undefined,
          size: primary?.size || undefined,
          platforms: primary?.platform
            ? [primary.platform]
            : Array.isArray(g.platform) && g.platform.length
              ? g.platform
              : undefined,
          lang: Array.isArray(g.language) && g.language.length ? g.language.join("/").slice(0, 40) : undefined,
          license: "",
          note: undefined,
        });

        const created = g.createdAt instanceof Date ? g.createdAt : new Date();
        const resource = await tx.resource.create({
          data: {
            slug: g.slug,
            title: g.title || g.slug,
            summary: String(summary).slice(0, 200),
            description,
            type: "GAME",
            status,
            authorId: author.id,
            categoryId: gameCat.id,
            nsfw: !!g.nsfw,
            isDownloadable: !!primary?.url,
            loginRequired: false,
            allowComments: true,
            externalUrl: primary?.url || "",
            viewCount: num(g.viewCount),
            downloadCount: num(g.downloadCount),
            meta,
            publishedAt: created,
            createdAt: created,
            updatedAt: g.updatedAt instanceof Date ? g.updatedAt : created,
          },
        });
        stats.resources++;

        // 3) 媒体：封面 + 截图（外链，status=READY）
        const cover = await tx.media.create({
          data: {
            resourceId: resource.id,
            kind: "COVER",
            storageKey: g.coverImage,
            uploaderId: author.id,
            mime: mimeOf(g.coverImage),
            fileName: fileNameOf(g.coverImage),
            sort: 0,
            status: "READY",
          },
        });
        await tx.resource.update({
          where: { id: resource.id },
          data: { coverMediaId: cover.id },
        });
        stats.media++;

        const shots: string[] = Array.isArray(g.screenshots) ? g.screenshots : [];
        const galleryRows = shots
          .filter((u) => !!u)
          .map((u, i) => ({
            resourceId: resource.id,
            kind: "GALLERY" as const,
            storageKey: u,
            uploaderId: author.id,
            mime: mimeOf(u),
            fileName: fileNameOf(u),
            sort: i + 1,
            status: "READY" as const,
          }));
        for (let i = 0; i < galleryRows.length; i += 500) {
          await tx.media.createMany({ data: galleryRows.slice(i, i + 500) });
        }
        stats.media += galleryRows.length;

        // 4) 标签
        const tagIds = gtByGame.get(g.id) ?? [];
        for (const tid of tagIds) {
          const t = tagById.get(tid);
          if (!t) continue;
          const tagId = await getTag(tx, t.name);
          await tx.tagOnResource.upsert({
            where: { resourceId_tagId: { resourceId: resource.id, tagId } },
            create: { resourceId: resource.id, tagId },
            update: {},
          });
          await tx.tag.update({
            where: { id: tagId },
            data: { count: { increment: 1 } },
          });
          stats.tags++;
          stats.tagLinks++;
        }

        if (stats.resources % 10 === 0)
          console.log(`  …已导入资源 ${stats.resources}/${games.length}`);
      }
    },
    { timeout: 600_000 },
  );

  console.log("✅ galgame → CMS 转换完成", stats);
  console.log("（资源按 slug 去重，重复运行不会二次插入）");
}

main()
  .catch((e) => {
    console.error("❌ 转换失败", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
