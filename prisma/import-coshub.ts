// CosHub → CMS（Pixel hub）结构转换导入脚本
// ---------------------------------------------------------------------------
// 数据源：prisma/coshub-data/{user,category,gallery}.json —— 自 Supabase CosHub
// 生产库（gal.best）导出的 JSON（见会话内备份流程）。
// 目标：当前 DATABASE_URL 指向的 CMS 库（schema 需与本项目一致；默认即 dev.db）。
//
// 用法：npx tsx prisma/import-coshub.ts
// 幂等：作者/分类/资源按唯一键已存在则跳过，可安全重复运行。
//
// 字段映射取舍（CosHub 无对应载体时）：
//   - Gallery → Resource(IMAGE, PUBLISHED)；三语标题 → title 用中文、英文并入说明
//   - cosplayer/character/series 无独立列 → 并入 summary + description「作品信息」区
//   - 分级 rating(sfw/nsfw) → meta.sourceNote 记录（CMS 无分级机制，全量照迁）
//   - 付费墙字段(price/isPremium/downloadUrl/订阅/订单) → 业务不同，不迁移
//   - images 为外链 URL（image.acg.lol），Media.storageKey 原样落库不下载；
//     cover == images[0] 对齐 CMS「封面行(kind COVER) + 图集行(kind GALLERY)」组织
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { slugify } from "../src/lib/slug";

const DIR = path.join(__dirname, "coshub-data");

type CUser = {
  id: string;
  email: string;
  username: string;
  passwordHash: string | null;
  nickname: string | null;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
};

type CCategory = {
  id: string;
  slug: string;
  name: Record<string, string>;
  sortOrder: number;
};

type CGallery = {
  id: string;
  slug: string;
  titleZh: string;
  titleEn: string;
  titleJa: string;
  cosplayer: string;
  character: string;
  series: string;
  cover: string;
  images: string[];
  categories: string[];
  tags: string[];
  rating: string; // "sfw" | "nsfw"
  viewCount: number | null;
  downloadCount: number | null;
  createdAt: string;
  updatedAt: string;
};

const read = <T>(file: string): T[] =>
  JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as T[];

const zhName = (c: { name: Record<string, string> }) => c.name.zh ?? c.name.en ?? c.name.ja ?? "";

const num = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? v : 0);
const fileNameOf = (url: string) => {
  try {
    return url.split("/").pop() || "image.webp";
  } catch {
    return "image.webp";
  }
};

/** Tag name 唯一、slug 唯一；slug 中文保留（slugify 白名单含汉字），撞 slug 加序号 */
async function getTag(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const clean = name.trim();
  const exist = await tx.tag.findUnique({ where: { name: clean } });
  if (exist) return exist.id;
  const base = slugify(clean) || "tag";
  let slug = base;
  for (let i = 2; await tx.tag.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
  const tag = await tx.tag.create({ data: { name: clean, slug, count: 0 } });
  return tag.id;
}

async function main() {
  const users = read<CUser>("user.json");
  const cats = read<CCategory>("category.json");
  const galleries = read<CGallery>("gallery.json");
  const catZh = new Map(cats.map((c) => [c.slug, zhName(c)]));

  const stats = {
    users: 0,
    userSkipped: 0,
    cats: 0,
    catSkipped: 0,
    resources: 0,
    resourceSkipped: 0,
    media: 0,
    tagLinks: 0,
  };

  await prisma.$transaction(
    async (tx) => {
      // 1) 作者：库中已有同邮箱/同名账号（如站主已先行注册为 ADMIN）则复用其 id，
      //    否则新建可信 USER（可信直发，保留原密码哈希与创建时间）
      const author = users[0];
      if (!author) throw new Error("coshub-data/user.json 为空，无法归属资源");
      let authorId: string | null = null;
      for (const u of users) {
        const hit = await tx.user.findFirst({
          where: { OR: [{ username: u.username }, { email: u.email }] },
        });
        if (hit) {
          stats.userSkipped++;
          if (u === author) authorId = hit.id;
          continue;
        }
        const nu = await tx.user.create({
          data: {
            id: u.id,
            email: u.email,
            username: u.username,
            passwordHash: u.passwordHash,
            name: u.nickname ?? u.username,
            role: "USER",
            trusted: true, // 原站内容均已上架，作者免审直发
            bio: "CosHub 迁移创作者",
            createdAt: new Date(u.createdAt),
            updatedAt: new Date(u.updatedAt),
          },
        });
        stats.users++;
        if (u === author) authorId = nu.id;
      }
      if (!authorId) throw new Error("未能确定图集归属作者 id");

      // 2) 分类：CosHub 9 分类（slug 与 CMS 无交集，全量新增）
      for (const c of cats) {
        const hit = await tx.category.findUnique({ where: { slug: c.slug } });
        if (hit) {
          stats.catSkipped++;
          continue;
        }
        await tx.category.create({
          data: { id: c.id, slug: c.slug, name: zhName(c), sort: c.sortOrder },
        });
        stats.cats++;
      }

      // 3) 资源（每 Gallery → 一个 IMAGE 资源）
      for (const g of galleries) {
        const exist = await tx.resource.findUnique({ where: { slug: g.slug } });
        if (exist) {
          stats.resourceSkipped++;
          continue;
        }

        const primaryCatSlug = g.categories?.[0] ?? null;
        const extraCatZh = (g.categories ?? [])
          .slice(1)
          .map((s) => catZh.get(s))
          .filter((n): n is string => !!n);

        // summary：作品 · 角色 优先，退回 Cosplayer / 主分类名
        const info = [g.series, g.character].filter((x) => x && x !== "原创");
        const summary =
          (info.length ? info.join(" · ") : "") ||
          (g.cosplayer ? `Cosplayer ${g.cosplayer}` : "") ||
          (primaryCatSlug && catZh.get(primaryCatSlug)) ||
          "Cosplay 图集";

        // description：结构化「作品信息」Markdown（原站无正文，descriptionZh 全空）
        const descLines: string[] = [];
        descLines.push(`> 图集共 **${g.images.length}** 张，外链图片（原图床 image.acg.lol）。`);
        descLines.push("");
        descLines.push("## 作品信息");
        descLines.push(`- 作品：${g.series || "-"}`);
        descLines.push(`- 角色：${g.character || "-"}`);
        descLines.push(`- Cosplayer：${g.cosplayer || "-"}`);
        if (g.titleEn && g.titleEn !== g.titleZh) descLines.push(`- 英文题名：*${g.titleEn}*`);
        if (g.titleJa && g.titleJa !== g.titleZh) descLines.push(`- 日文题名：*${g.titleJa}*`);
        descLines.push(`- 原站分类：${g.categories?.join(" / ") || "-"}`);
        const description = descLines.join("\n");

        const created = new Date(g.createdAt);
        const resource = await tx.resource.create({
          data: {
            id: g.id,
            slug: g.slug,
            title: g.titleZh || g.titleEn || g.slug,
            summary,
            description,
            type: "IMAGE",
            status: "PUBLISHED",
            authorId,
            categoryId: primaryCatSlug ? (await tx.category.findUnique({ where: { slug: primaryCatSlug } }))?.id ?? null : null,
            viewCount: num(g.viewCount),
            downloadCount: num(g.downloadCount),
            meta: JSON.stringify({
              isAiGenerated: false,
              original: false,
              license: "",
              sourceNote: `原站 CosHub 评级：${g.rating}`,
            }),
            publishedAt: created,
            createdAt: created,
            updatedAt: new Date(g.updatedAt),
          },
        });
        stats.resources++;

        // 4) 媒体：images[0]=封面行 + images[1..]=图集行（保留原排序）
        const cover = await tx.media.create({
          data: {
            resourceId: resource.id,
            kind: "COVER",
            storageKey: g.cover || g.images[0],
            uploaderId: authorId,
            mime: "image/webp",
            fileName: fileNameOf(g.cover || g.images[0]),
            sort: 0,
            status: "READY", // 外链图无需本地处理
          },
        });
        await tx.resource.update({ where: { id: resource.id }, data: { coverMediaId: cover.id } });
        const galleryRows = (g.images ?? []).slice(1).map((url, i) => ({
          resourceId: resource.id,
          kind: "GALLERY" as const,
          storageKey: url,
          uploaderId: authorId,
          mime: "image/webp",
          fileName: fileNameOf(url),
          sort: i + 1,
          status: "READY" as const,
        }));
        // 分批写入（PG 无 SQLite 绑定变量上限，500/批减少远端往返）
        for (let i = 0; i < galleryRows.length; i += 500) {
          await tx.media.createMany({ data: galleryRows.slice(i, i + 500) });
        }
        stats.media += 1 + galleryRows.length;

        // 5) 标签：CosHub 标签 + 副分类（转中文标签）；主分类不入标签
        const tagNames = new Set<string>([...(g.tags ?? []), ...extraCatZh]);
        for (const name of tagNames) {
          const tagId = await getTag(tx, name);
          await tx.tagOnResource.upsert({
            where: { resourceId_tagId: { resourceId: resource.id, tagId } },
            create: { resourceId: resource.id, tagId },
            update: {},
          });
          await tx.tag.update({ where: { id: tagId }, data: { count: { increment: 1 } } });
          stats.tagLinks++;
        }

        if (stats.resources % 20 === 0) console.log(`  …已导入资源 ${stats.resources}/${galleries.length}`);
      }
    },
    { timeout: 600_000 },
  );

  console.log("✅ CosHub → CMS 转换完成", stats);
  console.log("资源媒体共", stats.media, "行；标签绑定", stats.tagLinks, "次");
  console.log("（作者/分类/资源按唯一键去重，重复运行不会二次插入）");
}

main()
  .catch((e) => {
    console.error("❌ 转换失败", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
