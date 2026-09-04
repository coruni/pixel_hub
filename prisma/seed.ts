// 演示种子数据（仅限开发环境；测试账号密码统一：test1234）。
// 生产部署禁止跑 seed：默认弱口令账号会直接成为管理员入口。
// 如确需 seed，用 SEED_PASSWORD 提供强口令。
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db/prisma";
import { DEFAULT_SECTIONS } from "../src/lib/home-config";
import { DEFAULT_THEME, THEME_KEY, serializeTheme } from "../src/lib/site-config";

const PASSWORD = process.env.SEED_PASSWORD ?? "test1234";
if (process.env.NODE_ENV === "production" && !process.env.SEED_PASSWORD) {
  throw new Error("生产环境跑 seed 必须设置 SEED_PASSWORD（默认弱口令被拒绝）");
}

// 中文简介里的英文标签用 slug 查询，故保留一份 name->slug 映射
type CAT = { slug: string; name: string; sort: number };
type TAG = { slug: string; name: string };

const CATS: CAT[] = [
  // 游戏
  { slug: "indie", name: "独立游戏", sort: 10 },
  { slug: "pixel", name: "像素复古", sort: 20 },
  { slug: "rpg", name: "角色扮演", sort: 30 },
  { slug: "sim", name: "模拟经营", sort: 40 },
  { slug: "adventure", name: "冒险解谜", sort: 50 },
  { slug: "sandbox", name: "开放世界", sort: 60 },
  // 图片
  { slug: "wallpaper", name: "壁纸精选", sort: 10 },
  { slug: "illustration", name: "原创插画", sort: 20 },
  { slug: "photography", name: "摄影", sort: 30 },
  { slug: "ai-art", name: "AI 生成艺术", sort: 40 },
  { slug: "screenshot", name: "游戏截图", sort: 50 },
  { slug: "article", name: "文章", sort: 10 },
];

const TAGS: TAG[] = [
  { slug: "indie", name: "Indie" },
  { slug: "pixel-art", name: "Pixel Art" },
  { slug: "retro", name: "Retro" },
  { slug: "rpg", name: "RPG" },
  { slug: "adventure", name: "Adventure" },
  { slug: "open-world", name: "开放世界" },
  { slug: "cyberpunk", name: "赛博朋克" },
  { slug: "neon", name: "霓虹" },
  { slug: "wallpaper", name: "壁纸" },
  { slug: "4k", name: "4K" },
  { slug: "nature", name: "自然" },
  { slug: "ocean", name: "海洋" },
  { slug: "minimal", name: "极简" },
  { slug: "ai-generated", name: "AI 生成" },
  { slug: "original", name: "原创" },
  { slug: "screenshot", name: "截图" },
  { slug: "fantasy", name: "幻想" },
];

// 每个资源封面的本地占位图（public/seed）
const SEED_FILES = ["cyber", "forest", "ocean", "pixel", "nebula", "minimal"] as const;

async function main() {
  console.log("🌱 开始写入种子数据…");
  await prisma.$transaction(
    async (tx) => {
    // —— 清空（幂等重跑）——
    await tx.auditLog.deleteMany();
    await tx.visit.deleteMany(); // 访问统计一并清空，避免演示库里混入陈旧 PV
    await tx.siteSetting.deleteMany();
    await tx.homeSection.deleteMany();
    await tx.notification.deleteMany();
    await tx.report.deleteMany();
    await tx.follow.deleteMany();
    await tx.like.deleteMany();
    await tx.favorite.deleteMany();
    await tx.collection.deleteMany();
    await tx.comment.deleteMany();
    await tx.media.deleteMany();
    await tx.tagOnResource.deleteMany();
    await tx.resource.deleteMany();
    await tx.tag.deleteMany();
    await tx.category.deleteMany();
    await tx.session.deleteMany();
    await tx.account.deleteMany();
    await tx.user.deleteMany();

    // —— 用户 ——
    const pwd = bcrypt.hashSync(PASSWORD, 10);
    const admin = await tx.user.create({
      data: {
        email: "admin@example.com", username: "admin", passwordHash: pwd,
        name: "站长", role: "ADMIN", trusted: true,
        bio: "站点管理员，负责审核与治理。",
      },
    });
    const creator = await tx.user.create({
      data: {
        email: "creator@example.com", username: "creator", passwordHash: pwd,
        name: "画师小林", role: "USER", trusted: true, // D6：可信创作者免审直发
        bio: "独立创作者 · 像素/插画/游戏截图，欢迎交流。",
      },
    });
    const demo = await tx.user.create({
      data: {
        email: "demo@example.com", username: "demo", passwordHash: pwd,
        name: "路人甲", role: "USER", trusted: false, // 普通用户：投稿进审核
        bio: "新来的游客，请多指教。",
      },
    });

    // —— 分类 ——
    const catMap = new Map<string, { id: string }>();
    for (const c of CATS) {
      const row = await tx.category.create({ data: c });
      catMap.set(c.slug, row);
    }

    // —— 标签 ——
    const tagMap = new Map<string, { id: string }>();
    for (const t of TAGS) {
      const row = await tx.tag.create({ data: { ...t, count: 0 } });
      tagMap.set(t.slug, row);
    }
    // 绑定资源标签并维护 count
    async function tagResource(resourceId: string, tagSlugs: string[]) {
      for (const slug of tagSlugs) {
        const tag = tagMap.get(slug)!;
        await tx.tagOnResource.create({ data: { resourceId, tagId: tag.id } });
        await tx.tag.update({ where: { id: tag.id }, data: { count: { increment: 1 } } });
      }
    }
    // 追加封面/图集媒体（uploaderId = 资源作者，发布认领校验属主时口径一致）
    const fileIdx = new Map(SEED_FILES.map((f, i) => [f, i]));
    async function addMedia(
      resourceId: string,
      kind: "COVER" | "GALLERY",
      file: (typeof SEED_FILES)[number],
      uploaderId: string,
      sort = 0
    ) {
      return tx.media.create({
        data: {
          resourceId, kind, uploaderId,
          storageKey: `seed/${file}.svg`, thumbKey: null, bigKey: null, placeholder: null,
          width: 1500, height: 1000, size: 900 + (fileIdx.get(file) ?? 0) * 100,
          mime: "image/svg+xml", sort,
          status: "READY", // 演示媒体直接就绪
          fileName: `${file}.svg`,
        },
      });
    }
    // 资源主体
    async function createResource(o: {
      authorId: string; type: "GAME" | "IMAGE" | "ARTICLE"; status: "PUBLISHED" | "PENDING" | "REJECTED";
      title: string; slug: string; summary: string; description: string;
      categorySlug?: string; externalUrl?: string | null; loginRequired?: boolean;
      meta?: object; rejectReason?: string | null;
      counts?: { view?: number; like?: number; fav?: number; comment?: number; download?: number };
    }) {
      const row = await tx.resource.create({
        data: {
          title: o.title, slug: o.slug, summary: o.summary, description: o.description,
          type: o.type, status: o.status, authorId: o.authorId,
          categoryId: o.categorySlug ? catMap.get(o.categorySlug)!.id : null,
          externalUrl: o.externalUrl ?? null,
          loginRequired: o.loginRequired ?? false,
          meta: o.meta ? JSON.stringify(o.meta) : null,
          rejectReason: o.rejectReason ?? null,
          viewCount: o.counts?.view ?? 0,
          likeCount: o.counts?.like ?? 0,
          favoriteCount: o.counts?.fav ?? 0,
          commentCount: o.counts?.comment ?? 0,
          downloadCount: o.counts?.download ?? 0,
          publishedAt: o.status === "PUBLISHED" ? new Date(Date.now() - (o.counts?.view ?? 1) * 1000) : null,
        },
      });
      return row;
    }

    // —— 资源 1：极简壁纸合辑（图片 · 直发）——
    const img1 = await createResource({
      authorId: creator.id, type: "IMAGE", status: "PUBLISHED",
      slug: "minimal-wallpaper-collection", title: "四季色调 · 极简壁纸合辑",
      summary: "干净低饱和的极简壁纸，适配深色桌面。",
      description:
        "一组以低饱和自然色为主的极简壁纸。\n\n## 说明\n- 尺寸 2560×1440 / 1440×900\n- 已整理进整包，底部可整包下载\n- 如用作商用请先联系作者\n\n## 收录\n含海洋、山野、夜色三套色调。",
      categorySlug: "wallpaper",
      meta: { isAiGenerated: false, original: false, license: "freeware", sourceNote: "公开素材整理" },
      counts: { view: 320, like: 2, fav: 1, download: 210 },
    });
    const img1_cover = await addMedia(img1.id, "COVER", "minimal", creator.id);
    await addMedia(img1.id, "GALLERY", "ocean", creator.id, 1);
    await addMedia(img1.id, "GALLERY", "forest", creator.id, 2);
    await tx.resource.update({ where: { id: img1.id }, data: { coverMediaId: img1_cover.id } });
    await tagResource(img1.id, ["wallpaper", "4k", "minimal", "nature"]);

    // —— 资源 2：像素游戏（游戏 · 外链 + 直发）——
    const game1 = await createResource({
      authorId: creator.id, type: "GAME", status: "PUBLISHED",
      slug: "pixel-mine-tales", title: "像素矿洞：地心冒险",
      summary: "免费独立像素解谜动作游戏，中文 / 全平台。",
      description:
        "《像素矿洞：地心冒险》一款融合探索与解谜的 2D 平台动作游戏。\n\n## 下载\n- 资源仅提供**网盘外链**（D1），解压即玩\n- 提取码见评论区置顶\n\n## 配置要求\n- 最低：双核 CPU / 2GB 内存 / 集成显卡\n- 推荐：四核 CPU / 4GB 内存",
      categorySlug: "pixel",
      externalUrl: "https://pan.example.com/s/abcd1234",
      loginRequired: true,
      meta: { version: "1.3.2", size: "96 MB", platforms: ["windows", "mac", "linux"], lang: "中文", license: "freeware" },
      counts: { view: 500, like: 3, fav: 0, comment: 2, download: 890 },
    });
    const game1_cover = await addMedia(game1.id, "COVER", "pixel", creator.id);
    await addMedia(game1.id, "GALLERY", "cyber", creator.id, 1);
    await tx.resource.update({ where: { id: game1.id }, data: { coverMediaId: game1_cover.id } });
    await tagResource(game1.id, ["indie", "pixel-art", "retro", "adventure"]);

    // —— 资源 3：AI 生成图集（图片 · 直发）——
    const img2 = await createResource({
      authorId: creator.id, type: "IMAGE", status: "PUBLISHED",
      slug: "ai-neon-city-dream", title: "城市梦境 · AI 霓虹概念",
      summary: "Midjourney 生成的赛博都市氛围图集。",
      description:
        "一组用 Midjourney 生成的赛博朋克风格概念图。\n\n> 标注：本图集为 **AI 生成**，工具 Midjourney v6（D2 合规标注）。\n\n授权：署名-非商业 CC-BY-NC。",
      categorySlug: "ai-art",
      meta: { isAiGenerated: true, aiTool: "Midjourney", aiModel: "v6", original: true, license: "CC-BY-NC" },
      counts: { view: 210, like: 1, fav: 1, comment: 0, download: 66 },
    });
    const img2_cover = await addMedia(img2.id, "COVER", "cyber", creator.id);
    await addMedia(img2.id, "GALLERY", "nebula", creator.id, 1);
    await addMedia(img2.id, "GALLERY", "pixel", creator.id, 2);
    await tx.resource.update({ where: { id: img2.id }, data: { coverMediaId: img2_cover.id } });
    await tagResource(img2.id, ["cyberpunk", "neon", "ai-generated", "original"]);

    // —— 资源 4：待审核（图片 · 普通用户投稿，D6）——
    const img3 = await createResource({
      authorId: demo.id, type: "IMAGE", status: "PENDING",
      slug: "sea-cloud-photo", title: "随手拍的云海与海",
      summary: "登顶拍的云海，分享给大家。",
      description: "原图摄影，欢迎作壁纸。",
      categorySlug: "photography",
      meta: { isAiGenerated: false, original: true, license: "CC-BY" },
      counts: {},
    });
    const img3_cover = await addMedia(img3.id, "COVER", "ocean", demo.id);
    await tx.resource.update({ where: { id: img3.id }, data: { coverMediaId: img3_cover.id } });
    await tagResource(img3.id, ["nature", "ocean"]);

    // —— 资源 5：被驳回（图片 · 演示打回原因通知）——
    const img4 = await createResource({
      authorId: demo.id, type: "IMAGE", status: "REJECTED",
      slug: "forwarded-fanart", title: "转发的一张同人图",
      summary: "看到好看的图转来分享。",
      description: "转发来源见水印。",
      categorySlug: "illustration",
      rejectReason: "无法确认授权与来源，请补充原作者授权说明后重新投稿。",
      meta: { isAiGenerated: false, original: false, license: "unknown", sourceNote: "转发，来源水印" },
      counts: {},
    });
    const img4_cover = await addMedia(img4.id, "COVER", "nebula", demo.id);
    await tx.resource.update({ where: { id: img4.id }, data: { coverMediaId: img4_cover.id } });
    await tagResource(img4.id, ["fantasy"]);

    // —— 资源 6：管理员推荐大作 ——
    const game2 = await createResource({
      authorId: admin.id, type: "GAME", status: "PUBLISHED",
      slug: "sky-citadel-open-world", title: "云中城 · 开放世界 Demo",
      summary: "官方展示 Demo，开放世界探索，含免费试玩版。",
      description:
        "《云中城》是主打漂浮群岛探索的开放世界游戏。\n\n## 下载\n此条目为官方展示 Demo 的网盘分流，正式版请至官网。\n\n## 声明\n试玩版为免费内容；正式版需在官网购买。",
      categorySlug: "sandbox",
      externalUrl: "https://www.example.com/download/demo",
      meta: { version: "0.9.0-demo", size: "1.2 GB", platforms: ["windows"], lang: "中文 / English", license: "commercial-demo" },
      counts: { view: 900, like: 8, fav: 2, comment: 0, download: 1200 },
    });
    const game2_cover = await addMedia(game2.id, "COVER", "forest", admin.id);
    await addMedia(game2.id, "GALLERY", "nebula", admin.id, 1);
    await tx.resource.update({ where: { id: game2.id }, data: { coverMediaId: game2_cover.id } });
    await tagResource(game2.id, ["open-world", "fantasy", "indie"]);

    // —— 资源 7：文章（无外链，正文即内容）——
    const art1 = await createResource({
      authorId: creator.id, type: "ARTICLE", status: "PUBLISHED",
      slug: "pixel-art-beginner-guide", title: "像素画入门：从 16×16 小图开始",
      summary: "写给零基础的像素画上手指南。",
      description:
        "像素画最适合入门的尺寸是 **16×16**——足够小，能在一小时内完成；又足够大，能放下基本形体。\n\n## 为什么从 16×16 开始\n- 画布小，容错高，不会陷入细节\n- 每一粒像素都要做决定，能快速建立「省色」意识\n- 完成一幅的成就感来得快，容易坚持\n\n## 三条原则\n1. **先剪影后上色**：只用单色把外轮廓画对，再加内部结构\n2. **限色**：一幅不超过 8 色，强迫自己用明暗而不是色相表达体积\n3. **放大检查**：100% 与 400% 交替看，保证小图也读得清\n\n> 像素画的本质是「在限制里做设计」。限制越明确，决策越容易。",
      categorySlug: "article",
      meta: { license: "原创" },
      counts: { view: 640, like: 5, fav: 2, comment: 1 },
    });
    const art1_cover = await addMedia(art1.id, "COVER", "pixel", creator.id);
    await tx.resource.update({ where: { id: art1.id }, data: { coverMediaId: art1_cover.id } });
    await tagResource(art1.id, ["pixel-art", "original"]);

    // —— 评论（楼层/回复）——
    const c1 = await tx.comment.create({
      data: {
        resourceId: game1.id, authorId: demo.id,
        content: "支持 Win11 吗？之前老版本进不去。",
      },
    });
    await tx.comment.create({
      data: {
        resourceId: game1.id, authorId: creator.id, parentId: c1.id,
        content: "支持的，1.3.x 已修复 Win11 兼容，见网盘更新说明 👍",
      },
    });
    const c3 = await tx.comment.create({
      data: {
        resourceId: img1.id, authorId: demo.id,
        content: "第三张太好看了，已经收藏当桌面。",
      },
    });
    await tx.comment.create({
      data: {
        resourceId: img1.id, authorId: creator.id, parentId: c3.id,
        content: "谢谢！想要高清原图包可以走整包下载。",
      },
    });

    // —— 点赞 / 收藏（与上方计数对应；另有模拟外部用户计数未落行）——
    await tx.like.create({ data: { userId: demo.id, resourceId: game1.id } });
    await tx.like.create({ data: { userId: demo.id, resourceId: img1.id } });
    await tx.like.create({ data: { userId: creator.id, resourceId: img2.id } });
    await tx.like.create({ data: { userId: demo.id, resourceId: img2.id } });

    // —— 关注 / 收藏夹 / 通知 ——
    await tx.follow.create({ data: { followerId: demo.id, followingId: creator.id } });
    await tx.follow.create({ data: { followerId: admin.id, followingId: creator.id } });
    const favCollection = await tx.collection.create({
      data: { ownerId: demo.id, name: "我的宝藏", description: "以后慢慢看" },
    });
    await tx.favorite.create({ data: { userId: demo.id, resourceId: img1.id, collectionId: favCollection.id } });
    await tx.favorite.create({ data: { userId: demo.id, resourceId: img2.id, collectionId: favCollection.id } });
    await tx.notification.create({
      data: {
        userId: demo.id, type: "SYSTEM",
        message: "欢迎加入社区！发布图片请如实标注 AI 生成与授权信息。",
      },
    });

    // —— 首页默认板块（WordPress 式布局引擎，见 home-config.ts）——
    for (const s of DEFAULT_SECTIONS) {
      await tx.homeSection.create({
        data: { kind: s.kind, title: s.title, order: s.order, enabled: s.enabled, config: JSON.stringify(s.config) },
      });
    }

    // —— 站点外观默认（侧边栏 + 详情模板，见 site-config.ts）——
    await tx.siteSetting.create({ data: { key: THEME_KEY, value: serializeTheme(DEFAULT_THEME) } });
    },
    // 全量重建 + SQLite 默认 5s 超时不够，放宽到 60s
    { timeout: 60_000 }
  );

  const counts = {
    用户: await prisma.user.count(),
    分类: await prisma.category.count(),
    标签: await prisma.tag.count(),
    资源: await prisma.resource.count(),
    媒体: await prisma.media.count(),
    评论: await prisma.comment.count(),
  };
  console.log("✅ 种子完成：", counts);
  console.log("测试账号（密码均 test1234）：admin / creator / demo");
}

main()
  .catch((e) => {
    console.error("❌ 种子失败", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
