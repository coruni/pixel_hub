/* eslint-disable no-console */
// 补充测试数据（幂等：以用户名 alice 存在与否判断是否已跑过；不清空基础 seed 数据）。
// 用法：npm run db:seed:extra
// 内容：6 个新用户（含封禁演示）/ 9 个资源（近 7 日分布，供趋势图与排序）/ 评论与楼中楼 /
// 点赞收藏关注（计数同步）/ creator 的互动通知（含评论锚点）/ 近 7 日 Visit PV·IP。
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { prisma } from "../src/lib/db/prisma";

// 测试账号密码统一：test1234（仅限开发环境，生产禁跑 seed，见 seed.ts）
const PASSWORD = process.env.SEED_PASSWORD ?? "test1234";
if (process.env.NODE_ENV === "production" && !process.env.SEED_PASSWORD) {
  throw new Error("生产环境跑 seed 必须设置 SEED_PASSWORD（默认弱口令被拒绝）");
}

function daysAgo(n: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SEED_FILES = ["cyber", "forest", "ocean", "pixel", "nebula", "minimal"] as const;

async function main() {
  const guard = await prisma.user.findUnique({ where: { username: "alice" } });
  if (guard) {
    console.log("ℹ️ 补充数据已存在（alice 存在），跳过。重跑请先 db:seed 重建。");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // —— 用户（近 7 日分布，供新用户趋势图）——
    const pwd = bcrypt.hashSync(PASSWORD, 10);
    const mkUser = (o: {
      username: string;
      name: string;
      bio: string;
      trusted?: boolean;
      banned?: boolean;
      createdAt: Date;
    }) =>
      tx.user.create({
        data: {
          email: `${o.username}@example.com`,
          username: o.username,
          passwordHash: pwd,
          name: o.name,
          role: "USER",
          trusted: o.trusted ?? false,
          bio: o.bio,
          createdAt: o.createdAt,
          bannedAt: o.banned ? new Date() : null,
          bannedReason: o.banned ? "测试封禁：批量灌水" : null,
        },
      });
    const alice = await mkUser({
      username: "alice",
      name: "画师阿栗",
      trusted: true,
      bio: "插画师，画樱花和海洋。",
      createdAt: daysAgo(6),
    });
    const bobo = await mkUser({
      username: "bobo",
      name: "像素猎人",
      trusted: true,
      bio: "独立游戏开发者。",
      createdAt: daysAgo(5, 14),
    });
    const cathy = await mkUser({
      username: "cathy",
      name: "云上歌",
      bio: "肉鸽爱好者，常驻评论区。",
      createdAt: daysAgo(4, 9),
    });
    const dave = await mkUser({
      username: "dave",
      name: "夜航星",
      bio: "截图收藏家。",
      createdAt: daysAgo(3, 20),
    });
    const eva = await mkUser({
      username: "eva",
      name: "摄影师Eva",
      bio: "拍海也拍街。",
      createdAt: daysAgo(2, 16),
    });
    await mkUser({
      username: "frank",
      name: "尝百草",
      bio: "（已封禁）测试账号。",
      banned: true,
      createdAt: daysAgo(1, 11),
    });

    const creator = await tx.user.findUniqueOrThrow({ where: { username: "creator" } });
    const demo = await tx.user.findUniqueOrThrow({ where: { username: "demo" } });
    const cat = async (slug: string) =>
      (await tx.category.findUniqueOrThrow({ where: { slug } })).id;
    const tag = async (slug: string) => (await tx.tag.findUniqueOrThrow({ where: { slug } })).id;

    // —— 资源（近 7 日分布，计数阶梯供热门/下载排序）——
    let mediaSeq = 0;
    async function addMedia(
      resourceId: string,
      file: (typeof SEED_FILES)[number],
      kind: "COVER" | "GALLERY" = "GALLERY",
      sort = 0,
    ) {
      return tx.media.create({
        data: {
          resourceId,
          kind,
          storageKey: `seed/${file}.svg`,
          width: 1500,
          height: 1000,
          size: 900 + (mediaSeq++ % 6) * 100,
          mime: "image/svg+xml",
          sort,
          status: "READY",
          fileName: `${file}.svg`,
        },
      });
    }
    type NewRes = {
      slug: string;
      title: string;
      summary: string;
      description: string;
      type: "GAME" | "IMAGE" | "ARTICLE";
      categorySlug: string;
      authorId: string;
      status?: "PUBLISHED" | "PENDING";
      externalUrl?: string;
      cover: (typeof SEED_FILES)[number];
      gallery?: (typeof SEED_FILES)[number][];
      tagSlugs?: string[];
      meta?: object;
      loginRequired?: boolean;
      counts?: { view: number; like: number; fav: number; download: number };
      createdAt: Date;
    };
    async function mkResource(o: NewRes) {
      const r = await tx.resource.create({
        data: {
          title: o.title,
          slug: o.slug,
          summary: o.summary,
          description: o.description,
          type: o.type,
          status: o.status ?? "PUBLISHED",
          authorId: o.authorId,
          categoryId: await cat(o.categorySlug),
          externalUrl: o.externalUrl ?? null,
          loginRequired: o.loginRequired ?? false,
          meta: o.meta ? JSON.stringify(o.meta) : null,
          viewCount: o.counts?.view ?? 0,
          likeCount: o.counts?.like ?? 0,
          favoriteCount: o.counts?.fav ?? 0,
          downloadCount: o.counts?.download ?? 0,
          createdAt: o.createdAt,
          publishedAt: (o.status ?? "PUBLISHED") === "PUBLISHED" ? o.createdAt : null,
        },
      });
      const cover = await addMedia(r.id, o.cover, "COVER");
      let s = 1;
      for (const g of o.gallery ?? []) await addMedia(r.id, g, "GALLERY", s++);
      await tx.resource.update({ where: { id: r.id }, data: { coverMediaId: cover.id } });
      for (const t of o.tagSlugs ?? []) {
        const tId = await tag(t);
        await tx.tagOnResource.create({ data: { resourceId: r.id, tagId: tId } });
        await tx.tag.update({ where: { id: tId }, data: { count: { increment: 1 } } });
      }
      return r;
    }

    const racer = await mkResource({
      slug: "neon-drift-racer",
      title: "霓虹漂移：夜赛",
      type: "GAME",
      categorySlug: "pixel",
      authorId: bobo.id,
      summary: "夜城霓虹题材的免费像素赛车小游戏。",
      description:
        "一款致敬 90 年代街机赛的像素风赛车游戏。\n\n## 下载\n- 网盘外链，解压即玩\n- 支持手柄与键盘\n\n> 含 12 条夜间赛道与 6 台可调校车辆。",
      externalUrl: "https://pan.example.com/s/neon-drift",
      loginRequired: true,
      cover: "cyber",
      gallery: ["pixel", "nebula"],
      tagSlugs: ["indie", "pixel-art", "cyberpunk"],
      meta: {
        version: "1.0",
        size: "45 MB",
        platforms: ["windows"],
        lang: "中文",
        license: "freeware",
      },
      counts: { view: 412, like: 6, fav: 2, download: 300 },
      createdAt: daysAgo(6, 15),
    });
    const mistwood = await mkResource({
      slug: "mistwood-roguelike",
      title: "雾林物语 · 肉鸽",
      type: "GAME",
      categorySlug: "rpg",
      authorId: cathy.id,
      summary: "手绘风的轻度肉鸽卡组构筑 Demo。",
      description:
        "在起雾的森林里构筑你的卡组。\n\n## 特色\n- 单局 20 分钟\n- 40+ 卡牌\n- 死亡不是结束，是build的一部分",
      externalUrl: "https://pan.example.com/s/mistwood",
      cover: "forest",
      gallery: ["ocean"],
      tagSlugs: ["indie", "rpg", "adventure"],
      meta: {
        version: "0.6-demo",
        size: "210 MB",
        platforms: ["windows", "mac"],
        lang: "中文",
        license: "freeware",
      },
      counts: { view: 268, like: 3, fav: 1, download: 180 },
      createdAt: daysAgo(4, 11),
    });
    const sakura = await mkResource({
      slug: "cherry-blossom-4k",
      title: "春樱 4K 壁纸",
      type: "IMAGE",
      categorySlug: "wallpaper",
      authorId: alice.id,
      summary: "八张春樱主题 4K 壁纸，横竖屏都有。",
      description: "花期很短，壁纸很长。\n\n- 3840×2160 ×6 / 竖屏 2160×3840 ×2\n- 仅供个人桌面使用",
      cover: "minimal",
      gallery: ["ocean", "forest", "pixel"],
      tagSlugs: ["wallpaper", "4k", "nature", "original"],
      meta: { isAiGenerated: false, original: true, license: "CC-BY-NC" },
      counts: { view: 730, like: 9, fav: 4, download: 512 },
      createdAt: daysAgo(5, 19),
    });
    const deepocean = await mkResource({
      slug: "deep-ocean-gallery",
      title: "深海微光图集",
      type: "IMAGE",
      categorySlug: "photography",
      authorId: eva.id,
      summary: "潜水时拍的深海生物微光系列。",
      description: "水下 18 米，只带一支手电。\n\n> 均为原图直出，仅做裁切。",
      cover: "ocean",
      gallery: ["cyber"],
      tagSlugs: ["nature", "ocean", "original"],
      meta: { isAiGenerated: false, original: true, license: "CC-BY" },
      counts: { view: 156, like: 2, fav: 0, download: 40 },
      createdAt: daysAgo(3, 13),
    });
    await mkResource({
      slug: "retro-arcade-screens",
      title: "街机厅截图档案",
      type: "IMAGE",
      categorySlug: "screenshot",
      authorId: dave.id,
      summary: "老街机厅的 CRT 滤镜截图合集。",
      description: "城市东边最后的街机厅，周末拍了二十多张。",
      cover: "pixel",
      tagSlugs: ["screenshot", "retro", "pixel-art"],
      meta: { isAiGenerated: false, original: true, license: "CC-BY" },
      counts: { view: 98, like: 1, fav: 0, download: 12 },
      createdAt: daysAgo(2, 21),
    });
    await mkResource({
      slug: "geometry-minimal-set",
      title: "几何极简头像框",
      type: "IMAGE",
      categorySlug: "illustration",
      authorId: alice.id,
      summary: "12 款几何风头像框，PNG 透明底。",
      description: "圆的方的三角的，总有一款适合你。",
      cover: "minimal",
      tagSlugs: ["minimal", "original"],
      meta: { isAiGenerated: false, original: true, license: "freeware" },
      counts: { view: 61, like: 1, fav: 0, download: 30 },
      createdAt: daysAgo(1, 18),
    });
    const picks = await mkResource({
      slug: "indie-game-pick-2026",
      title: "2026 上半年独立游戏精选",
      type: "ARTICLE",
      categorySlug: "article",
      authorId: creator.id,
      summary: "个人向的上半年独立游戏推荐清单。",
      description:
        "挑了 10 款今年上半年玩过、且愿意二周目的独立游戏。\n\n## 名单\n1. 霓虹漂移：夜赛\n2. 雾林物语 · 肉鸽\n3. ……（篇幅所限列前二）\n\n> 完整名单与试玩感受见正文描述。",
      cover: "nebula",
      tagSlugs: ["indie", "original"],
      meta: { license: "原创" },
      counts: { view: 385, like: 4, fav: 2, download: 0 },
      createdAt: daysAgo(3, 10),
    });
    await mkResource({
      slug: "pixel-color-palette-guide",
      title: "像素画选色速查",
      type: "ARTICLE",
      categorySlug: "article",
      authorId: bobo.id,
      summary: "常用像素画色板与选色思路整理。",
      description:
        "限色是像素画的第一课。\n\n## 三套常用色板\n- 8 色 Retro\n- 16 色 Sweetie\n- 32 色 Endesga\n\n> 色不在多，在于层级分明。",
      cover: "pixel",
      tagSlugs: ["pixel-art"],
      meta: { license: "原创" },
      counts: { view: 142, like: 1, fav: 0, download: 0 },
      createdAt: daysAgo(1, 12),
    });
    await mkResource({
      slug: "fan-made-poster",
      title: "自制像素游戏海报",
      type: "IMAGE",
      categorySlug: "illustration",
      authorId: eva.id,
      status: "PENDING",
      summary: "给喜欢的游戏画的一张海报，第一次投稿。",
      description: "临摹练习作品，投个稿试试。",
      cover: "nebula",
      tagSlugs: ["original", "fantasy"],
      meta: { isAiGenerated: false, original: true, license: "CC-BY-NC" },
      counts: { view: 0, like: 0, fav: 0, download: 0 },
      createdAt: daysAgo(0, 9, 30),
    });

    // —— 评论（含楼中楼；计数同步）——
    async function mkComment(
      resourceId: string,
      authorId: string,
      content: string,
      createdAt: Date,
      parentId?: string,
    ) {
      const c = await tx.comment.create({
        data: { resourceId, authorId, content, parentId, createdAt },
      });
      await tx.resource.update({
        where: { id: resourceId },
        data: { commentCount: { increment: 1 } },
      });
      return c;
    }
    const c1 = await mkComment(
      racer.id,
      alice.id,
      "霓虹反射的路面效果太对味了，求 macOS 版！",
      daysAgo(5, 16),
    );
    await mkComment(racer.id, bobo.id, "Mac 版在做了，月底前放出来～", daysAgo(5, 17), c1.id);
    await mkComment(sakura.id, cathy.id, "第二张夜樱直接设成锁屏了，谢谢分享。", daysAgo(4, 12));
    const c3 = await mkComment(
      picks.id,
      dave.id,
      "霓虹漂移确实好玩，手感调得很顺。",
      daysAgo(2, 22),
    );
    await mkComment(picks.id, creator.id, "对，手柄震动手感也做得细。", daysAgo(2, 23), c3.id);

    // —— 点赞 / 收藏（落行 + 计数同步）——
    async function mkLike(userId: string, resourceId: string, createdAt: Date) {
      await tx.like.create({ data: { userId, resourceId, createdAt } });
      await tx.resource.update({
        where: { id: resourceId },
        data: { likeCount: { increment: 1 } },
      });
    }
    await mkLike(alice.id, racer.id, daysAgo(5, 15));
    await mkLike(cathy.id, racer.id, daysAgo(4, 8));
    await mkLike(dave.id, racer.id, daysAgo(3, 12));
    await mkLike(bobo.id, sakura.id, daysAgo(4, 10));
    await mkLike(cathy.id, sakura.id, daysAgo(3, 9));
    await mkLike(eva.id, sakura.id, daysAgo(2, 14));
    await mkLike(alice.id, picks.id, daysAgo(2, 20));
    await mkLike(dave.id, mistwood.id, daysAgo(3, 18));

    const defaultCollection = await tx.collection.findFirst({ where: { ownerId: demo.id } });
    async function mkFav(
      userId: string,
      resourceId: string,
      createdAt: Date,
      collectionId?: string,
    ) {
      await tx.favorite.create({ data: { userId, resourceId, collectionId, createdAt } });
      await tx.resource.update({
        where: { id: resourceId },
        data: { favoriteCount: { increment: 1 } },
      });
    }
    await mkFav(demo.id, sakura.id, daysAgo(3, 15), defaultCollection?.id);
    await mkFav(eva.id, picks.id, daysAgo(2, 9));

    // —— 关注（新用户 → creator，creator 主页粉丝数有形）——
    for (const [u, t] of [
      [alice, daysAgo(5, 11)],
      [bobo, daysAgo(4, 15)],
      [cathy, daysAgo(2, 10)],
      [dave, daysAgo(1, 19)],
    ] as const) {
      await tx.follow.create({ data: { followerId: u.id, followingId: creator.id, createdAt: t } });
    }

    // —— 通知（给 creator：点赞/评论带锚点/关注，均可点验）——
    await tx.notification.create({
      data: {
        userId: creator.id,
        type: "LIKE",
        actorId: alice.id,
        resourceId: picks.id,
        createdAt: daysAgo(2, 20),
      },
    });
    await tx.notification.create({
      data: {
        userId: creator.id,
        type: "COMMENT",
        actorId: dave.id,
        resourceId: picks.id,
        commentId: c3.id,
        createdAt: daysAgo(2, 22),
      },
    });
    await tx.notification.create({
      data: { userId: creator.id, type: "FOLLOW", actorId: alice.id, createdAt: daysAgo(5, 11) },
    });

    // —— Visit：近 7 日 PV/IP（趋势图数据；hash 无需可还原，随机即可）——
    const hotPaths = [
      "/",
      "/browse",
      "/search",
      "/resources/neon-drift-racer",
      "/resources/cherry-blossom-4k",
      "/resources/pixel-mine-tales",
      "/u/creator",
    ];
    const visitRows: { day: string; ipHash: string; path: string; createdAt: Date }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = daysAgo(i);
      const key = dayKey(day);
      // 近两日流量高，更早的日子逐步走低
      const pv = i === 0 ? 86 : i === 1 ? 64 : 18 + Math.round(Math.random() * 26) + (6 - i) * 4;
      const ips = Math.max(2, Math.round(pv / 4));
      const ipHashes = Array.from({ length: ips }, () =>
        createHash("sha256").update(randomBytes(8)).digest("hex").slice(0, 16),
      );
      for (let p = 0; p < pv; p++) {
        const ipHash = ipHashes[Math.floor(Math.random() * ipHashes.length)];
        const path = hotPaths[Math.floor(Math.random() * hotPaths.length)];
        const at = new Date(day);
        at.setMinutes(Math.floor(Math.random() * 60));
        visitRows.push({ day: key, ipHash, path, createdAt: at });
      }
    }
    await tx.visit.createMany({ data: visitRows });
  });

  const counts = {
    用户: await prisma.user.count(),
    资源: await prisma.resource.count(),
    评论: await prisma.comment.count(),
    点赞: await prisma.like.count(),
    收藏: await prisma.favorite.count(),
    关注: await prisma.follow.count(),
    通知: await prisma.notification.count(),
    访问记录: await prisma.visit.count(),
  };
  console.log("✅ 补充数据完成：", counts);
  console.log("新测试账号（密码 test1234）：alice / bobo / cathy / dave / eva / frank(封禁)");
}

main()
  .catch((e) => {
    console.error("❌ 补充数据失败", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
