/* eslint-disable no-console */
// 批量测试数据（幂等：以 username「lyra」存在与否判断是否已跑过；不清空基础 seed 数据）。
// 用法：npm run db:seed（基础）→ npm run db:seed:extra（可选）→ npm run db:seed:bulk（本脚本）
// 目的：基础 seed 太精致太少，翻页/时间窗/后台表格/趋势图都测不充分。本脚本用模板灌一批
// 「够测试」的数据（数量见 VOL）。like/favorite/comment 计数与真实落行保持一致，可验证各种 toggle。
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";

const PASSWORD = process.env.SEED_PASSWORD ?? "test1234";
if (process.env.NODE_ENV === "production" && !process.env.SEED_PASSWORD) {
  throw new Error("生产环境跑 seed 必须设置 SEED_PASSWORD（默认弱口令被拒绝）");
}

// ---------- 规模（想更多/更少就调这里） ----------
const VOL = {
  image: 80, // 已发布图片（分布 5 个图类分类，每类 16）
  game: 60, // 已发布游戏（6 个游戏分类 × 10）
  article: 40, // 已发布文章
  pending: 24, // 待审（近几日投稿）
  rejected: 10, // 打回
  draft: 12, // 草稿
  removed: 6, // 下架
};

const IMG_CATS = ["wallpaper", "illustration", "photography", "ai-art", "screenshot"] as const;
const GAME_CATS = ["indie", "pixel", "rpg", "sim", "adventure", "sandbox"] as const;

// 标签只能引用基础 seed 里已存在的 slug（TAGS 见 prisma/seed.ts）
const IMG_TAGS: Record<string, readonly string[]> = {
  wallpaper: ["wallpaper", "4k", "minimal", "nature"],
  illustration: ["original", "fantasy", "minimal"],
  photography: ["nature", "ocean"],
  "ai-art": ["ai-generated", "cyberpunk", "neon"],
  screenshot: ["screenshot", "retro", "pixel-art"],
};
const GAME_TAGS: Record<string, readonly string[]> = {
  indie: ["indie", "retro"],
  pixel: ["pixel-art", "indie", "retro"],
  rpg: ["rpg", "fantasy", "indie"],
  sim: ["indie", "minimal"],
  adventure: ["adventure", "indie"],
  sandbox: ["open-world", "fantasy"],
};

const FILES = ["cyber", "forest", "ocean", "pixel", "nebula", "minimal"] as const;

// ---------- 时间 / 随机（确定性 PRNG，mulberry32） ----------
let _s = 0x5eedb01d;
function rnd(): number {
  _s |= 0;
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (n: number) => Math.floor(rnd() * n);
const pick = <T>(arr: readonly T[]): T => arr[ri(arr.length)];
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = ri(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function sampleK<T>(arr: readonly T[], k: number): T[] {
  const copy = [...arr];
  return shuffle(copy).slice(0, Math.max(0, k));
}
// 带权展开成作者序列再洗牌（避免同作者扎堆）
function authorsOf(q: Array<[string, number]>): string[] {
  const flat: string[] = [];
  for (const [u, n] of q) for (let i = 0; i < n; i++) flat.push(u);
  return shuffle(flat);
}
// 资源发布/创建时间：向今天倾斜，约 40% 落在近 7 天（趋势图/时间窗好看）
function agoDay(): Date {
  const day = Math.min(29, Math.floor(Math.pow(Math.max(1e-4, Math.min(0.9999, rnd())), 1.6) * 30));
  return daysAgo(day, ri(24), ri(60));
}
function daysAgo(n: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
const pad = (i: number, w = 4) => String(i).padStart(w, "0");

// 热度档位 → 浏览/下载/互动量级
function popularity(): { view: number; download: number; like: number; fav: number } {
  const r = rnd();
  if (r > 0.93)
    return { view: 1500 + ri(4500), download: 500 + ri(2500), like: 14 + ri(6), fav: 6 + ri(6) };
  if (r > 0.72)
    return { view: 300 + ri(900), download: 60 + ri(400), like: 4 + ri(7), fav: 1 + ri(4) };
  return { view: 20 + ri(260), download: 0, like: ri(4), fav: 0 };
}

// 新增用户：trusted 直发；MODERATOR 演示审核角色；zed 封禁用于治理列表
const NEW_USERS = [
  { username: "lyra", name: "山岚", trusted: true, role: "USER", bio: "插画师，画山与海的蓝。" },
  {
    username: "nina",
    name: "尼娜工作室",
    trusted: true,
    role: "USER",
    bio: "独立游戏工作室，像素向。",
  },
  {
    username: "oscar",
    name: "奥斯卡",
    trusted: true,
    role: "USER",
    bio: "游戏杂谈作者，月更两次。",
  },
  { username: "leo", name: "阿泽", trusted: true, role: "USER", bio: "壁纸收集整理爱好者。" },
  { username: "mia", name: "米娅", trusted: false, role: "USER", bio: "新晋创作者，偶尔摸鱼。" },
  { username: "sam", name: "小杉", trusted: false, role: "USER", bio: "摄影入门，街拍练手。" },
  {
    username: "rex",
    name: "瑞克斯",
    trusted: true,
    role: "USER",
    bio: "独立游戏开发者，肉鸽爱好者。",
  },
  { username: "pia", name: "皮皮", trusted: false, role: "USER", bio: "潜水看图的游客。" },
  { username: "tess", name: "苔丝", trusted: false, role: "USER", bio: "潜水看图的游客。" },
  { username: "yuri", name: "有理", trusted: false, role: "USER", bio: "潜水看图的游客。" },
  { username: "zoe", name: "佐伊", trusted: false, role: "USER", bio: "潜水看图的游客。" },
  { username: "wren", name: "苇儿", trusted: false, role: "USER", bio: "潜水看图的游客。" },
  { username: "quinn", name: "小葵", trusted: false, role: "USER", bio: "潜水看图的游客。" },
  { username: "magic", name: "摩卡", trusted: false, role: "USER", bio: "潜水看图的游客。" },
  { username: "iris", name: "鸢尾", trusted: false, role: "USER", bio: "潜水看图的游客。" },
  { username: "nova", name: "诺娃", trusted: false, role: "USER", bio: "潜水看图的游客。" },
  { username: "kai", name: "卡伊", trusted: false, role: "USER", bio: "潜水看图的游客。" },
  { username: "moderator", name: "审校官", trusted: true, role: "MODERATOR", bio: "内容审核员。" },
  {
    username: "zed",
    name: "席德",
    trusted: false,
    role: "USER",
    bio: "已封禁测试号。",
    banned: true,
  },
  { username: "vera", name: "薇拉", trusted: false, role: "USER", bio: "潜水看图的游客。" },
] as const;

// 内容词库
const IMG_THEME = [
  "云海",
  "夜樱",
  "海边灯塔",
  "雾中森林",
  "城市天台",
  "霓虹街巷",
  "机械花园",
  "旧书店",
  "雪山湖泊",
  "深海水母",
  "极光小镇",
  "雨夜窗台",
  "浮空岛",
  "沙漠孤舟",
  "田园黄昏",
  "山间晨雾",
  "码头渔船",
  "银河拱桥",
  "废土机车",
  "太空站",
  "峡谷藤蔓",
  "雨林萤火",
  "海上日出",
  "都市剪影",
  "湖畔倒影",
  "风车山野",
  "雪地列车",
  "樱花巷",
  "暮色钟楼",
  "海边石阶",
] as const;
const IMG_MOOD = [
  "低饱和",
  "柔和光",
  "胶片感",
  "霓虹",
  "清新",
  "暗调",
  "极简",
  "浓郁",
  "朦胧",
  "蒸汽波",
  "钢笔淡彩",
  "复古",
  "科幻",
  "治愈",
  "强对比",
  "黑白",
] as const;
const GAME_NAME = [
  "像素星港",
  "地心工厂",
  "潮汐行者",
  "机械恐龙",
  "星港快递",
  "雾都侦探",
  "电子妖刀",
  "空岛牧场",
  "地心列车",
  "赛博绿洲",
  "古堡夜巡",
  "漂浮渔村",
  "像素足球",
  "城市基建",
  "火箭试飞",
  "迷你战争",
  "时光迷宫",
  "蒸汽农田",
  "太阳帆船",
  "岩洞渔人",
  "雾林精灵",
  "金属乐团",
  "像素棋局",
  "深夜食堂模拟",
  "电子舞蹈",
  "齿轮城",
  "冰原猎人",
  "岩浆攀爬",
  "雨夜飙车",
  "量子园艺",
] as const;
const ARTICLE_TITLE = [
  "像素画入门",
  "独立游戏体验随笔",
  "配色方案整理",
  "关卡设计拆解",
  "开发日志",
  "画风研究",
  "一图流教程",
  "年度清单",
  "工具评测",
  "社区观察",
  "美术杂谈",
  "音乐制作随笔",
] as const;
const LICENSES = ["CC-BY", "CC-BY-NC", "freeware"] as const;
const AI_TOOLS = ["Midjourney", "Stable Diffusion", "DALL·E", "NovelAI"] as const;
const COMMENT_POOL = [
  "这个真不错，收藏了。",
  "想问下支持 xxx 吗？",
  "已下载，质量很高，谢谢分享。",
  "画风太对味了，蹲一个更新。",
  "之前那版的问题修好了吗？",
  "感谢整理，正好需要。",
  "楼上的说得对，补充一点…",
  "试了下，手感很顺。",
  "请问有中文说明吗？",
  "氛围感拉满，好评。",
  "别的不说，封面就赢麻了。",
  "提个小建议：希望加个夜间模式。",
  "支持！已三连。",
  "蹲一个 Mac 版。",
  "这位作者的作品质量都挺稳的。",
  "码住，周末试试。",
  "内容详实，受教了。",
] as const;

type ResourceType = "GAME" | "IMAGE" | "ARTICLE";
type ResStatus = "PUBLISHED" | "PENDING" | "REJECTED" | "DRAFT" | "REMOVED";

type Plan = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  type: ResourceType;
  status: ResStatus;
  authorId: string;
  categoryId: string;
  externalUrl: string | null;
  loginRequired: boolean;
  meta: string | null;
  rejectReason: string | null;
  counts: { view: number; download: number; like: number; fav: number; comment: number };
  createdAt: Date;
  publishedAt: Date | null;
  cover: (typeof FILES)[number] | null;
  gallery: (typeof FILES)[number][];
  tagSlugs: string[];
  likeUsers: string[];
  favUsers: string[];
};

async function main() {
  const guard = await prisma.user.findUnique({ where: { username: "lyra" } });
  if (guard) {
    console.log("ℹ️ 批量数据已存在（lyra 存在），跳过。重跑请先 db:seed 重建。");
    return;
  }

  // 前置依赖：基础 seed 的账号/分类/标签
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  const creator = await prisma.user.findUniqueOrThrow({ where: { username: "creator" } });
  const demo = await prisma.user.findUniqueOrThrow({ where: { username: "demo" } });

  console.log("🌱 开始写入批量测试数据（约需几十秒）…");

  await prisma.$transaction(
    async (tx) => {
      // ---- 分类 / 标签 id（预取，避免循环里 N+1）----
      const catMap = new Map<string, string>();
      for (const s of [...IMG_CATS, ...GAME_CATS, "article"]) {
        catMap.set(s, (await tx.category.findUniqueOrThrow({ where: { slug: s } })).id);
      }
      const tagMap = new Map<string, string>();
      const tagId = async (s: string) => {
        let id = tagMap.get(s);
        if (!id) {
          id = (await tx.tag.findUniqueOrThrow({ where: { slug: s } })).id;
          tagMap.set(s, id);
        }
        return id;
      };

      // ---- 用户 ----
      const pwd = bcrypt.hashSync(PASSWORD, 10);
      const userMap = new Map<string, string>([
        ["admin", admin.id],
        ["creator", creator.id],
        ["demo", demo.id],
      ]);
      const userRows: Prisma.UserCreateManyInput[] = NEW_USERS.map((u, i) => ({
        id: `bu_${pad(i, 2)}`,
        email: `${u.username}@example.com`,
        username: u.username,
        passwordHash: pwd,
        name: u.name,
        bio: u.bio,
        role: u.role,
        trusted: u.trusted,
        bannedAt: "banned" in u && u.banned ? new Date() : null,
        bannedReason: "banned" in u && u.banned ? "测试封禁：广告灌水" : null,
        createdAt: agoDay(),
        lastSeenAt: rnd() > 0.35 ? new Date(Date.now() - ri(5) * 3600 * 1000) : null,
      }));
      for (const u of userRows) userMap.set(u.username, u.id!);
      await tx.user.createMany({ data: userRows });

      const bannedIds = new Set(userRows.filter((u) => u.bannedAt).map((u) => u.id));
      const interactPool = [...userMap.values()].filter((id) => !bannedIds.has(id));

      // ---- 资源计划 ----
      const authors = {
        IMAGE: authorsOf([
          ["creator", 8],
          ["admin", 6],
          ["demo", 6],
          ["lyra", 30],
          ["nina", 4],
          ["oscar", 4],
          ["leo", 10],
          ["mia", 6],
          ["sam", 6],
        ]), // = 80
        GAME: authorsOf([
          ["creator", 4],
          ["admin", 10],
          ["nina", 18],
          ["oscar", 2],
          ["rex", 6],
          ["leo", 8],
          ["mia", 6],
          ["sam", 4],
          ["kai", 2],
        ]), // = 60
        ARTICLE: authorsOf([
          ["creator", 16],
          ["admin", 4],
          ["oscar", 12],
          ["nina", 2],
          ["leo", 2],
          ["mia", 2],
          ["sam", 2],
        ]), // = 40
      };

      const plans: Plan[] = [];
      let seq = 0;

      function planOne(o: {
        slug: string;
        title: string;
        summary: string;
        description: string;
        type: ResourceType;
        categorySlug: string;
        authorUsername: string;
        tagSlugs: string[];
        cover: (typeof FILES)[number] | null;
        gallery?: (typeof FILES)[number][];
        externalUrl?: string | null;
        loginRequired?: boolean;
        meta?: Record<string, unknown> | null;
        rejectReason?: string | null;
        status?: ResStatus;
      }): Plan {
        const authorId = userMap.get(o.authorUsername);
        if (!authorId) throw new Error(`bulk 作者不存在: ${o.authorUsername}`);
        const catId = catMap.get(o.categorySlug);
        if (!catId) throw new Error(`bulk 分类不存在: ${o.categorySlug}`);
        const status = o.status ?? "PUBLISHED";
        const createdAt = agoDay();
        const publishedAt = status === "PUBLISHED" || status === "REMOVED" ? createdAt : null;
        const isPub = status === "PUBLISHED";
        const pop = isPub ? popularity() : { view: 0, download: 0, like: 0, fav: 0 };
        const commentTarget = isPub
          ? pop.like > 12
            ? 8 + ri(10)
            : rnd() < 0.4
              ? 1 + ri(5)
              : ri(3)
          : 0;
        // 互动人数受互动池限制，保证行数与计数一致
        const others = interactPool.filter((u) => u !== authorId);
        const likeUsers = isPub ? sampleK(others, Math.min(pop.like, others.length)) : [];
        const favUsers = isPub ? sampleK(others, Math.min(pop.fav, others.length)) : [];
        return {
          id: `br_${pad(seq++, 4)}`,
          slug: o.slug,
          title: o.title,
          summary: o.summary,
          description: o.description,
          type: o.type,
          status,
          authorId,
          categoryId: catId,
          externalUrl: o.externalUrl ?? null,
          loginRequired: o.loginRequired ?? false,
          meta: o.meta != null ? JSON.stringify(o.meta) : null,
          rejectReason: o.rejectReason ?? null,
          counts: {
            view: pop.view,
            download: pop.download,
            like: likeUsers.length,
            fav: favUsers.length,
            comment: commentTarget,
          },
          createdAt,
          publishedAt,
          cover: o.cover,
          gallery: o.gallery ?? [],
          tagSlugs: o.tagSlugs,
          likeUsers,
          favUsers,
        };
      }

      // 已发布图片：每类 16
      for (let i = 0; i < VOL.image; i++) {
        const cat = IMG_CATS[i % IMG_CATS.length];
        const theme = pick(IMG_THEME);
        const mood = pick(IMG_MOOD);
        const isAi = cat === "ai-art";
        plans.push(
          planOne({
            slug: `bulk-image-${pad(i)}`,
            title: `${theme}·${mood} 壁纸合辑`,
            summary: `${theme}主题的${mood}风壁纸，适合深色桌面。`,
            description:
              `一组「${theme}」主题的${mood}风壁纸（测试数据 #${i}）。\n\n` +
              `## 说明\n- 尺寸 2560×1440 / 1440×900\n- 收录 ${theme} 与 ${mood} 两套色调\n- 仅供个人桌面使用\n\n` +
              `> 授权：${isAi ? "AI 生成，需署名标注" : "原图，注明出处可使用"}。`,
            type: "IMAGE",
            categorySlug: cat,
            authorUsername: authors.IMAGE[i % authors.IMAGE.length],
            cover: FILES[(i * 5 + 1) % FILES.length],
            gallery: [FILES[(i * 5 + 3) % FILES.length], FILES[(i * 5 + 4) % FILES.length]],
            tagSlugs: [...IMG_TAGS[cat]],
            meta: {
              isAiGenerated: isAi,
              aiTool: isAi ? pick(AI_TOOLS) : undefined,
              aiModel: isAi ? "v6" : undefined,
              original: !isAi,
              license: isAi ? "CC-BY-NC" : pick(LICENSES),
              sourceNote: isAi ? `由 ${pick(AI_TOOLS)} 生成` : undefined,
            },
          }),
        );
      }
      // 已发布游戏：每类 10
      for (let i = 0; i < VOL.game; i++) {
        const cat = GAME_CATS[i % GAME_CATS.length];
        const name = pick(GAME_NAME);
        const ver = `${1 + ri(2)}.${ri(10)}.${ri(6)}`;
        plans.push(
          planOne({
            slug: `bulk-game-${pad(i)}`,
            title: `${name} · ${pick(["Demo", "试玩版", "抢先体验", "完整版"])}`,
            summary: `${name}，一款免费${cat === "rpg" ? "角色扮演" : cat === "sim" ? "模拟经营" : "像素冒险"}类独立游戏（测试 #${i}）。`,
            description:
              `《${name}》是一款主打${cat === "rpg" ? "剧情与构筑" : cat === "sandbox" ? "开放探索" : "爽快手感"}的独立游戏。\n\n` +
              `## 下载\n- 网盘外链，解压即玩：https://pan.example.com/s/bulk-game-${pad(i)}\n- 解压密码见评论区置顶\n\n` +
              `## 版本 ${ver}\n- 新增：${pick(["新手引导", "二周目模式", "自定义按键", "成就系统"])}\n- 修复若干已知问题\n\n` +
              `## 配置要求\n- 最低：双核 CPU / 2GB 内存\n- 推荐：四核 CPU / 4GB 内存`,
            type: "GAME",
            categorySlug: cat,
            authorUsername: authors.GAME[i % authors.GAME.length],
            cover: FILES[(i * 3 + 2) % FILES.length],
            gallery: [FILES[(i * 3 + 1) % FILES.length]],
            tagSlugs: [...GAME_TAGS[cat]],
            externalUrl: `https://pan.example.com/s/bulk-game-${pad(i)}`,
            loginRequired: i % 3 === 0,
            meta: {
              version: ver,
              size: `${(45 + ri(400) + Math.round(rnd() * 10) / 10).toFixed(1)} MB`,
              platforms: sampleK(["windows", "mac", "linux"], 1 + ri(2)),
              lang: pick(["中文", "中文 / English", "多语言"]),
              license: "freeware",
              note: "批量测试数据",
            },
          }),
        );
      }
      // 已发布文章
      for (let i = 0; i < VOL.article; i++) {
        const t = pick(ARTICLE_TITLE);
        plans.push(
          planOne({
            slug: `bulk-article-${pad(i)}`,
            title: `${t}（${i + 1}）`,
            summary: `一篇${t}向的测试文章，正文见描述。`,
            description:
              `## 摘要\n${t}相关主题的第 ${i + 1} 篇内容。\n\n` +
              `## 正文\n这里是一段 Markdown 正文，用来测试富文本排版、代码块与列表。\n\n` +
              `1. 第一点：${pick(["保持克制", "先做减法", "多玩多拆解"])}\n` +
              `2. 第二点：${pick(["记录想法", "一周一更", "完成比完美重要"])}\n\n` +
              `> 结论：${pick(["实践出真知。", "限制里才有自由。", "慢慢来比较快。"])}\n\n---\n批量测试数据 #${i}。`,
            type: "ARTICLE",
            categorySlug: "article",
            authorUsername: authors.ARTICLE[i % authors.ARTICLE.length],
            cover: FILES[(i * 7 + 4) % FILES.length],
            tagSlugs: ["indie", "original"],
            meta: { license: "原创" },
          }),
        );
      }

      // 非发布状态（PENDING/REJECTED/DRAFT/REMOVED）
      const extraAuthor = (pickName: string[]) => pick(pickName);
      for (let i = 0; i < VOL.pending; i++) {
        plans.push(
          planOne({
            slug: `bulk-pending-${pad(i)}`,
            title: `待审投稿 · ${i + 1}`,
            summary: "新投稿，等待审核。",
            description: "刚提交的内容，用于演示后台「待审队列」。",
            type: i % 3 === 0 ? "GAME" : "IMAGE",
            categorySlug: (i % 3 === 0 ? GAME_CATS : IMG_CATS)[
              i % (i % 3 === 0 ? GAME_CATS.length : IMG_CATS.length)
            ],
            authorUsername:
              i % 2 === 0 ? "demo" : extraAuthor(["mia", "sam", "pia", "tess", "yuri"]),
            status: "PENDING",
            cover: pick(FILES),
            gallery: [],
            tagSlugs: [],
            meta: { isAiGenerated: false, original: false, license: "unknown" },
          }),
        );
      }
      const rejectReasons = [
        "无法确认授权与来源，请补充原作者授权说明后重新投稿。",
        "AI 生成图未如实标注，请更正信息后再投。",
        "封面与正文不符，请更换封面。",
        "疑似重复投稿。",
      ];
      for (let i = 0; i < VOL.rejected; i++) {
        plans.push(
          planOne({
            slug: `bulk-rejected-${pad(i)}`,
            title: `打回示例 · ${i + 1}`,
            summary: "被打回的内容，演示打回原因通知。",
            description: "用于演示「REJECTED」列表与打回原因。",
            type: "IMAGE",
            categorySlug: IMG_CATS[i % IMG_CATS.length],
            authorUsername: i % 2 === 0 ? "demo" : extraAuthor(["mia", "tess", "yuri"]),
            status: "REJECTED",
            rejectReason: rejectReasons[i % rejectReasons.length],
            cover: pick(FILES),
            gallery: [],
            tagSlugs: [],
            meta: { isAiGenerated: false, original: false, license: "unknown" },
          }),
        );
      }
      for (let i = 0; i < VOL.draft; i++) {
        plans.push(
          planOne({
            slug: `bulk-draft-${pad(i)}`,
            title: `草稿 · ${i + 1}`,
            summary: "未提交的草稿，仅作者/站长可见。",
            description: "还没写完的草稿，用于测试 DRAFT 状态与「我的草稿」。",
            type: i % 2 === 0 ? "IMAGE" : "ARTICLE",
            categorySlug: i % 2 === 0 ? IMG_CATS[i % IMG_CATS.length] : "article",
            authorUsername: pick(["creator", "nina", "leo", "oscar"]),
            status: "DRAFT",
            cover: null,
            gallery: [],
            tagSlugs: [],
          }),
        );
      }
      for (let i = 0; i < VOL.removed; i++) {
        plans.push(
          planOne({
            slug: `bulk-removed-${pad(i)}`,
            title: `已下架内容 · ${i + 1}`,
            summary: "曾经发布后被下架。",
            description: "用于演示 REMOVED 列表与后台「已下架」。",
            type: i % 2 === 0 ? "GAME" : "IMAGE",
            categorySlug: (i % 2 === 0 ? GAME_CATS : IMG_CATS)[
              i % (i % 2 === 0 ? GAME_CATS.length : IMG_CATS.length)
            ],
            authorUsername: pick(["creator", "leo", "rex", "sam"]),
            status: "REMOVED",
            cover: pick(FILES),
            gallery: [],
            tagSlugs: [],
            meta: { isAiGenerated: false, original: false, license: "unknown" },
          }),
        );
      }

      // ============ 落库（依赖顺序：用户 → 资源 → 媒体/封面 → 标签 → 评论 → 点赞收藏 → 关注 → 通知 → 访问/日志） ============
      const resourceRows: Prisma.ResourceCreateManyInput[] = plans.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        summary: p.summary,
        description: p.description,
        type: p.type,
        status: p.status,
        authorId: p.authorId,
        categoryId: p.categoryId,
        externalUrl: p.externalUrl,
        loginRequired: p.loginRequired,
        isDownloadable: p.type !== "ARTICLE",
        meta: p.meta,
        rejectReason: p.rejectReason,
        viewCount: p.counts.view,
        likeCount: p.counts.like,
        favoriteCount: p.counts.fav,
        downloadCount: p.counts.download,
        commentCount: p.status === "PUBLISHED" ? p.counts.comment : 0, // 评论落库后按实际校正
        createdAt: p.createdAt,
        publishedAt: p.publishedAt,
      }));
      await tx.resource.createMany({ data: resourceRows });

      // 媒体（封面 + 图集）
      const mediaRows: Prisma.MediaCreateManyInput[] = [];
      const coverByRes = new Map<string, string>();
      let m = 0;
      for (const p of plans) {
        const mk = (
          file: (typeof FILES)[number],
          kind: "COVER" | "GALLERY",
          sort: number,
        ): string => {
          const id = `bm_${pad(m++, 5)}`;
          mediaRows.push({
            id,
            resourceId: p.id,
            kind,
            uploaderId: p.authorId,
            storageKey: `seed/${file}.svg`,
            thumbKey: null,
            bigKey: null,
            width: 1500,
            height: 1000,
            size: 800 + ri(3200),
            mime: "image/svg+xml",
            sort,
            status: "READY",
            fileName: `${file}.svg`,
          });
          return id;
        };
        if (p.cover) coverByRes.set(p.id, mk(p.cover, "COVER", 0));
        p.gallery.forEach((g, gi) => mk(g, "GALLERY", gi + 1));
      }
      for (let i = 0; i < mediaRows.length; i += 500) {
        await tx.media.createMany({ data: mediaRows.slice(i, i + 500) });
      }
      // 封面认领（media 行已存在才能写外键）
      for (const p of plans) {
        const cid = coverByRes.get(p.id);
        if (cid) await tx.resource.updateMany({ where: { id: p.id }, data: { coverMediaId: cid } });
      }

      // 标签
      const torRows: Prisma.TagOnResourceCreateManyInput[] = [];
      const tagCountDelta = new Map<string, number>();
      for (const p of plans) {
        if (p.status === "DRAFT") continue;
        for (const s of p.tagSlugs) {
          const t = await tagId(s);
          torRows.push({ resourceId: p.id, tagId: t });
          tagCountDelta.set(s, (tagCountDelta.get(s) ?? 0) + 1);
        }
      }
      if (torRows.length) await tx.tagOnResource.createMany({ data: torRows });
      for (const [s, d] of tagCountDelta) {
        await tx.tag.updateMany({
          where: { id: await tagId(s) },
          data: { count: { increment: d } },
        });
      }

      // 评论（顶层 + 楼中楼；commentCount 以真实落行为准）
      const commentRows: Prisma.CommentCreateManyInput[] = [];
      const commentByRes = new Map<string, number>();
      const firstCommentByRes = new Map<string, string>();
      let c = 0;
      for (const p of plans) {
        if (p.status !== "PUBLISHED" || p.counts.comment === 0) continue;
        const topN = Math.max(1, Math.ceil(p.counts.comment * 0.75));
        const replyN = p.counts.comment - topN;
        const others = interactPool.filter((u) => u !== p.authorId);
        const tops: string[] = [];
        for (let k = 0; k < topN; k++) {
          const id = `bc_${pad(c++, 5)}`;
          commentRows.push({
            id,
            resourceId: p.id,
            authorId: others[k % others.length],
            parentId: null,
            content: pick(COMMENT_POOL),
            createdAt: daysAgo(ri(3), ri(24), ri(60)),
          });
          tops.push(id);
          commentByRes.set(p.id, (commentByRes.get(p.id) ?? 0) + 1);
          if (!firstCommentByRes.has(p.id)) firstCommentByRes.set(p.id, id);
        }
        for (let k = 0; k < replyN; k++) {
          const parentId = tops[k % tops.length];
          const parent = commentRows.find((r) => r.id === parentId);
          if (!parent) continue;
          const replyOthers = others.filter((u) => u !== parent.authorId);
          if (replyOthers.length === 0) continue;
          commentRows.push({
            id: `bc_${pad(c++, 5)}`,
            resourceId: p.id,
            authorId: replyOthers[k % replyOthers.length],
            parentId,
            content: pick(COMMENT_POOL),
            createdAt: daysAgo(ri(3), ri(24), ri(60)),
          });
          commentByRes.set(p.id, (commentByRes.get(p.id) ?? 0) + 1);
        }
      }
      for (let i = 0; i < commentRows.length; i += 500) {
        await tx.comment.createMany({ data: commentRows.slice(i, i + 500) });
      }
      // 校正 commentCount（与落行一致）
      const commentFix: Array<{ id: string; n: number }> = [];
      for (const p of plans) {
        const n = commentByRes.get(p.id) ?? 0;
        if (n !== p.counts.comment) commentFix.push({ id: p.id, n });
      }
      for (const f of commentFix) {
        await tx.resource.updateMany({ where: { id: f.id }, data: { commentCount: f.n } });
      }

      // 点赞 / 收藏（默认夹）；行数 = resource 计数
      const likeRows: Prisma.LikeCreateManyInput[] = [];
      for (const p of plans) {
        const base = p.publishedAt?.getTime() ?? Date.now() - ri(2) * 864e5;
        for (const uid of p.likeUsers) {
          likeRows.push({
            id: `bl_${pad(likeRows.length, 6)}`,
            userId: uid,
            resourceId: p.id,
            createdAt: new Date(base + ri(3600e3)),
          });
        }
      }
      const favRows: Prisma.FavoriteCreateManyInput[] = [];
      const collRows: Prisma.CollectionCreateManyInput[] = [];
      const collByUser = new Map<string, string>();
      const favOwners = new Set<string>();
      for (const p of plans) for (const uid of p.favUsers) favOwners.add(uid);
      for (const uid of favOwners) {
        const cid = `bcol_${uid}`;
        collRows.push({ id: cid, ownerId: uid, name: "默认收藏" });
        collByUser.set(uid, cid);
      }
      if (collRows.length) await tx.collection.createMany({ data: collRows });
      for (const p of plans) {
        const base = p.publishedAt?.getTime() ?? Date.now() - ri(2) * 864e5;
        for (const uid of p.favUsers) {
          favRows.push({
            id: `bf_${pad(favRows.length, 6)}`,
            userId: uid,
            collectionId: collByUser.get(uid) ?? null,
            resourceId: p.id,
            createdAt: new Date(base + ri(3600e3)),
          });
        }
      }
      for (let i = 0; i < likeRows.length; i += 500)
        await tx.like.createMany({ data: likeRows.slice(i, i + 500) });
      for (let i = 0; i < favRows.length; i += 500)
        await tx.favorite.createMany({ data: favRows.slice(i, i + 500) });

      // 关注（排除已有关注，避免撞复合主键）
      const fansOf: Array<{ target: string; want: number }> = [
        { target: "creator", want: 7 },
        { target: "lyra", want: 5 },
        { target: "nina", want: 4 },
      ];
      const existingFollow = new Set<string>();
      const tids = fansOf.map((f) => userMap.get(f.target)!).filter(Boolean);
      if (tids.length) {
        const rows = await tx.follow.findMany({
          where: { followingId: { in: tids } },
          select: { followerId: true, followingId: true },
        });
        for (const r of rows) existingFollow.add(`${r.followerId}:${r.followingId}`);
      }
      const followRows: Prisma.FollowCreateManyInput[] = [];
      for (const { target, want } of fansOf) {
        const tid = userMap.get(target)!;
        const candidates = interactPool.filter(
          (u) => u !== tid && !existingFollow.has(`${u}:${tid}`),
        );
        for (const f of sampleK(candidates, want))
          followRows.push({
            followerId: f,
            followingId: tid,
            createdAt: daysAgo(ri(20), ri(24), ri(60)),
          });
      }
      await tx.follow.createMany({ data: followRows });

      // 通知：creator 收 LIKE/COMMENT/FOLLOW；demo 收 MODERATION（打回）
      const notifRows: Prisma.NotificationCreateManyInput[] = [];
      const creatorRes = plans.filter((p) => p.status === "PUBLISHED" && p.authorId === creator.id);
      for (const p of creatorRes) {
        const likeRow = likeRows.find((l) => l.resourceId === p.id);
        if (likeRow)
          notifRows.push({
            userId: creator.id,
            actorId: likeRow.userId,
            type: "LIKE",
            resourceId: p.id,
            commentId: null,
            createdAt: likeRow.createdAt,
          });
        const cid = firstCommentByRes.get(p.id);
        const cmt = cid ? commentRows.find((r) => r.id === cid) : null;
        if (cmt)
          notifRows.push({
            userId: creator.id,
            actorId: cmt.authorId,
            type: "COMMENT",
            resourceId: p.id,
            commentId: cmt.id,
            createdAt: cmt.createdAt,
          });
      }
      for (const f of followRows) {
        if (f.followingId === creator.id && notifRows.length < 60)
          notifRows.push({
            userId: creator.id,
            actorId: f.followerId,
            type: "FOLLOW",
            resourceId: null,
            commentId: null,
            createdAt: f.createdAt,
          });
      }
      const demoRejected = plans.filter((p) => p.status === "REJECTED" && p.authorId === demo.id);
      for (const p of demoRejected) {
        notifRows.push({
          userId: demo.id,
          actorId: admin.id,
          type: "MODERATION",
          resourceId: p.id,
          commentId: null,
          message: `你的投稿「${p.title}」未通过审核：${p.rejectReason ?? ""}`,
          createdAt: daysAgo(ri(3), ri(24), ri(60)),
        });
      }
      await tx.notification.createMany({ data: notifRows });

      // 访问记录：近 30 天（今日与近 7 天更高）；ipHash 复用固定池，累计 IP 才像样
      const ipHash = (i: number) =>
        createHash("sha256").update(`bulkseed${i}`).digest("hex").slice(0, 16);
      const ipPool = Array.from({ length: 400 }, (_, i) => ipHash(i));
      const pubPaths = plans
        .filter((p) => p.status === "PUBLISHED")
        .map((p) => `/resources/${p.slug}`);
      const paths = [
        "/",
        "/browse",
        "/search",
        "/tags/wallpaper",
        "/u/creator",
        "/u/lyra",
        ...pubPaths.slice(0, 80),
      ];
      const visitRows: Prisma.VisitCreateManyInput[] = [];
      for (let d = 29; d >= 0; d--) {
        const base = d === 0 ? 150 + ri(60) : d <= 6 ? 85 + ri(50) : 40 + ri(45);
        const ips = sampleK(ipPool, Math.max(12, Math.round(base * 0.55)));
        const day = daysAgo(d);
        const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(
          day.getDate(),
        ).padStart(2, "0")}`;
        for (let p = 0; p < base; p++) {
          const at = new Date(day);
          at.setMinutes(ri(60));
          visitRows.push({
            day: key,
            ipHash: ips[p % ips.length],
            path: paths[ri(paths.length)],
            createdAt: at,
          });
        }
      }
      for (let i = 0; i < visitRows.length; i += 600) {
        await tx.visit.createMany({ data: visitRows.slice(i, i + 600) });
      }

      // 审计日志
      const auditRows: Prisma.AuditLogCreateManyInput[] = [];
      for (const p of plans) {
        if (p.status === "REJECTED")
          auditRows.push({
            adminId: admin.id,
            action: "REJECT",
            targetType: "RESOURCE",
            targetId: p.id,
            note: p.rejectReason ?? "",
            createdAt: p.createdAt,
          });
        if (p.status === "REMOVED")
          auditRows.push({
            adminId: admin.id,
            action: "REMOVE_RESOURCE",
            targetType: "RESOURCE",
            targetId: p.id,
            note: "违规外链（演示）",
            createdAt: p.createdAt,
          });
      }
      const bannedRow = userRows.find((u) => u.bannedAt);
      if (bannedRow)
        auditRows.push({
          adminId: admin.id,
          action: "BAN",
          targetType: "USER",
          targetId: bannedRow.id,
          note: "广告灌水（测试）",
          createdAt: daysAgo(1, 9),
        });
      for (const u of ["lyra", "nina", "oscar", "rex", "leo"]) {
        auditRows.push({
          adminId: admin.id,
          action: "TRUST",
          targetType: "USER",
          targetId: userMap.get(u)!,
          note: "开通免审直发（测试）",
          createdAt: daysAgo(2, 10),
        });
      }
      await tx.auditLog.createMany({ data: auditRows });
    },
    { timeout: 180_000 },
  );

  const counts = {
    用户: await prisma.user.count(),
    资源: await prisma.resource.count(),
    已发布: await prisma.resource.count({ where: { status: "PUBLISHED" } }),
    待审: await prisma.resource.count({ where: { status: "PENDING" } }),
    媒体: await prisma.media.count(),
    评论: await prisma.comment.count(),
    点赞: await prisma.like.count(),
    收藏: await prisma.favorite.count(),
    关注: await prisma.follow.count(),
    通知: await prisma.notification.count(),
    访问记录: await prisma.visit.count(),
  };
  console.log("✅ 批量数据完成：", counts);
  console.log(
    "新增测试账号（密码均 test1234）：lyra / nina / oscar / leo / rex / mia / sam / kai / vera … / moderator / zed(封禁)",
  );
}

main()
  .catch((e) => {
    console.error("❌ 批量数据失败", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
