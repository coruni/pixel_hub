// 音视频（MUSIC / VIDEO）演示数据 —— 用于验收前台展示效果。
//
// 背景：库里 MUSIC / VIDEO 两条类型原本是 0 条，前台（/browse 的类型页签、资源详情页播放卡、
// 首页「为你推荐 / 精选内容」）没有任何音视频可看。本脚本灌一批覆盖「来源 × 播放形态 × 边界」的
// 资源，一次跑完就能把各分支都在真实页面上看到。
//
// 覆盖矩阵：
//   1 音乐 · 在线挂载 · 直链      → 原生 <audio> 播放器 + 外链「前往来源」
//   2 音乐 · 在线挂载 · 嵌入页    → sandbox iframe（网易云外链播放器）
//   3 音乐 · 上传文件 · 站内托管  → 原生播放 + 「下载音频」+ 下载清单（走统一登录墙/计数）
//   4 视频 · 在线挂载 · 直链      → 原生 <video> 播放器
//   5 视频 · 在线挂载 · 嵌入页    → sandbox iframe（B站播放器）
//   6 视频 · 上传文件 · 站内托管  → 原生播放 + 「下载视频」+ 下载清单
//   7 视频 · 无播放来源（url 空） → 「作者未提供播放来源」空态
//
// 用法（幂等，可反复跑）：
//   npx tsx prisma/seed-av-demo.ts           # 写入/刷新演示数据
//   npx tsx prisma/seed-av-demo.ts --clean   # 只清除演示数据（含本地样例文件）
//
// 数据标记：资源 slug 一律以 demo-av- 开头，只按这个前缀读写，不会碰到其它内容。
// 本地样例文件写到 public/uploads/demo-av/（该目录已 gitignore，不进版本库）。

import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db/prisma";
import { parseId3 } from "../src/lib/av-probe";
import { syncResourceSearch } from "../src/lib/search";

const SLUG_PREFIX = "demo-av-";
const CLEAN_ONLY = process.argv.includes("--clean");
const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

/** 演示分类（缺失才建），让类型页签 / 分类筛选都有归属 */
const CATEGORIES = [
  { slug: "music", name: "音乐", sort: 30 },
  { slug: "video", name: "视频", sort: 31 },
];

/** 演示标签（缺失才建），用于详情页标签区展示 */
const TAGS = [
  { slug: "ost", name: "原声" },
  { slug: "piano", name: "钢琴" },
  { slug: "sample-clip", name: "样片" },
];

/** 站内托管样例文件：按顺序取第一个下载成功的源 */
const LOCAL_AUDIO_SRC = [
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
];
const LOCAL_AUDIO_KEY = "demo-av/audio/soundhelix-song-2.mp3";

const LOCAL_VIDEO_SRC = [
  {
    url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4",
    resolution: "720p",
    duration: "0:10",
  },
  {
    url: "https://www.w3schools.com/html/mov_bbb.mp4",
    resolution: "480p",
    duration: "0:10",
  },
];
const LOCAL_VIDEO_KEY = "demo-av/video/big-buck-bunny-720p.mp4";

/** 外链直链视频（按顺序取第一个可用的）——1080p 与 720p 各试一次 */
const EXT_VIDEO_SRC = [
  {
    url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4",
    resolution: "1080p",
    duration: "0:10",
  },
  ...LOCAL_VIDEO_SRC,
];

/** 外链直链音频 */
const EXT_AUDIO_URL = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";

/** 嵌入页地址（都实测无 X-Frame-Options，可被 sandbox iframe 挂载） */
const EMBED_AUDIO_URL =
  "https://music.163.com/outchain/player?type=2&id=186016&auto=0&height=66";
const EMBED_VIDEO_URL =
  "https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7&page=1&high_quality=1";

function daysAgo(n: number, hour = 12): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 20, 0, 0);
  return d;
}

function humanSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

/**
 * MP3 时长估算：跳过 ID3v2 头，找到第一个帧同步字后按该帧的比特率（CBR 口径）折算。
 * 只为演示数据填一个像样的「时长」，不是精确解码。
 */
function mp3DurationSec(buf: Buffer): number | null {
  let off = 0;
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "ID3") {
    off =
      10 +
      ((buf[6] & 0x7f) << 21 |
        (buf[7] & 0x7f) << 14 |
        (buf[8] & 0x7f) << 7 |
        (buf[9] & 0x7f));
  }
  // MPEG1 / MPEG2 / MPEG2.5 的 Layer III 比特率表（kbps）
  const BR: Record<number, number[]> = {
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
    0: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  };
  for (let i = off; i + 4 < buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const ver = (buf[i + 1] >> 3) & 0x03;
    const layer = (buf[i + 1] >> 1) & 0x03;
    const kbps = BR[ver]?.[(buf[i + 2] >> 4) & 0x0f] ?? 0;
    if (ver === 1 || layer === 0 || !kbps) continue;
    return Math.round(((buf.length - off) * 8) / (kbps * 1000));
  }
  return null;
}

/** 下载远端样例文件到 public/uploads/<key>（已存在则复用），失败返回 null */
async function ensureLocalFile(
  key: string,
  urls: string[],
): Promise<{ url: string; size: number; from: string } | null> {
  const abs = path.join(UPLOAD_ROOT, key);
  let from = existsSync(abs) ? "已存在（跳过下载）" : "";
  if (!existsSync(abs)) {
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength < 1024) throw new Error("文件过小");
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, buf);
        from = url;
        console.log(`   ⤓ 下载样例文件 ${key} (${humanSize(buf.byteLength)})`);
        break;
      } catch (e) {
        console.log(`   ⚠ 下载失败 ${url}：${(e as Error).message}`);
      }
    }
  }
  if (!existsSync(abs)) return null;
  return { url: `/uploads/${key}`, size: readFileSync(abs).byteLength, from };
}

/** 探测地址可用性（嵌入页不需要探测，直链用 Range 取 1 字节判断） */
async function pickReachable<T extends { url: string }>(list: T[]): Promise<T | null> {
  for (const it of list) {
    try {
      const res = await fetch(it.url, { headers: { Range: "bytes=0-1023" } });
      if (res.ok || res.status === 206) return it;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

type DemoItem = {
  slug: string;
  type: "MUSIC" | "VIDEO";
  title: string;
  summary: string;
  description: string;
  categorySlug: string;
  tagSlugs: string[];
  meta: Record<string, unknown>;
  counts: { view: number; like: number; fav: number };
  publishedAt: Date;
};

async function main() {
  const demoResources = await prisma.resource.findMany({
    where: { slug: { startsWith: SLUG_PREFIX } },
    select: { id: true, slug: true },
  });

  // —— 清除模式：只删演示数据 ——
  if (CLEAN_ONLY) {
    await prisma.resource.deleteMany({ where: { id: { in: demoResources.map((r) => r.id) } } });
    await prisma.tag.deleteMany({ where: { slug: { in: TAGS.map((t) => t.slug) }, count: { lte: 0 } } });
    for (const c of CATEGORIES) {
      const used = await prisma.resource.count({ where: { category: { slug: c.slug } } });
      if (used === 0) await prisma.category.deleteMany({ where: { slug: c.slug } });
    }
    rmSync(path.join(UPLOAD_ROOT, "demo-av"), { recursive: true, force: true });
    console.log(`✅ 已清除 ${demoResources.length} 条演示资源（含本地样例文件）`);
    return;
  }

  const author =
    (await prisma.user.findFirst({ where: { username: "maplene" } })) ??
    (await prisma.user.findFirst({ where: { role: "ADMIN" } })) ??
    (await prisma.user.findFirst());
  if (!author) throw new Error("库里没有任何用户，先执行 npm run db:seed");

  // —— 分类 / 标签：缺失才建（名字也唯一，先按 slug/name 双向查一次，避免撞唯一约束） ——
  const catId = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row =
      (await prisma.category.findFirst({ where: { OR: [{ slug: c.slug }, { name: c.name }] } })) ??
      (await prisma.category.create({ data: c }));
    catId.set(c.slug, row.id);
  }
  const tagId = new Map<string, string>();
  for (const t of TAGS) {
    const row =
      (await prisma.tag.findFirst({ where: { OR: [{ slug: t.slug }, { name: t.name }] } })) ??
      (await prisma.tag.create({ data: t }));
    tagId.set(t.slug, row.id);
  }

  // —— 封面：复用库里已有的可用图片键（chevereto 远端 URL，publicUrl 会原样返回） ——
  const pool = await prisma.media.findMany({
    where: { kind: "COVER", status: "READY", mime: { startsWith: "image/" } },
    select: { storageKey: true, mime: true },
    orderBy: { createdAt: "desc" },
    skip: 30,
    take: 24,
  });
  const covers = pool.filter((m) => m.storageKey.startsWith("http"));
  if (covers.length === 0) throw new Error("库里没有可复用的封面图（kind=COVER / READY）");

  // —— 样例音视频文件与可用外链 ——
  console.log("准备样例文件与外链地址…");
  const localAudio = await ensureLocalFile(LOCAL_AUDIO_KEY, LOCAL_AUDIO_SRC);
  const localVideo = await ensureLocalFile(
    LOCAL_VIDEO_KEY,
    LOCAL_VIDEO_SRC.map((v) => v.url),
  );
  const videoSource =
    LOCAL_VIDEO_SRC.find((v) => v.url === localVideo?.from) ?? LOCAL_VIDEO_SRC[0];
  const extVideo = await pickReachable(EXT_VIDEO_SRC);
  if (!localAudio) console.log("   ⚠ 本地音频未就绪，站内托管音频那条将回退为外链");
  if (!localVideo) console.log("   ⚠ 本地视频未就绪，站内托管视频那条将回退为外链");

  // 本地音频的真实标签与时长（ID3 + 帧头估算）
  let audioMeta: { artist?: string; album?: string; title?: string } = {};
  let audioDuration = "6:00";
  if (localAudio) {
    const buf = readFileSync(path.join(UPLOAD_ROOT, LOCAL_AUDIO_KEY));
    audioMeta = parseId3(buf);
    const sec = mp3DurationSec(buf);
    if (sec) audioDuration = mmss(sec);
  }

  const localAudioUrl = localAudio?.url ?? EXT_AUDIO_URL;
  const localVideoUrl = localVideo?.url ?? (extVideo?.url ?? LOCAL_VIDEO_SRC[0].url);

  const items: DemoItem[] = [
    {
      slug: `${SLUG_PREFIX}music-mount-direct`,
      type: "MUSIC",
      title: "像素电台 Vol.1 · 在线挂载直链",
      summary: "在线挂载 + 直链：浏览器原生音频播放器，外链来源本站不托管。",
      description: [
        "**验收点：在线挂载 · 直链播放**",
        "",
        "- 播放区应为浏览器原生 `<audio>` 播放器（非 iframe）",
        "- 顶部信息行：时长 / 来源平台 / 艺术家 · 专辑",
        "- 底部提示：以「外链直链」挂载，本站不托管 +「前往来源」链接",
        "- 卡片角标应为音乐图标（brand 色）",
      ].join("\n"),
      categorySlug: "music",
      tagSlugs: ["ost"],
      meta: {
        source: "mount",
        mode: "direct",
        url: EXT_AUDIO_URL,
        provider: "外链直链",
        artist: "Pixel Radio",
        album: "Demo Sessions Vol.1",
        duration: "6:12",
        license: "CC BY 4.0",
        note: "演示数据：直链音源，使用浏览器原生播放器",
        downloads: [],
      },
      counts: { view: 2431, like: 186, fav: 74 },
      publishedAt: daysAgo(1, 20),
    },
    {
      slug: `${SLUG_PREFIX}music-mount-embed`,
      type: "MUSIC",
      title: "像素电台 Vol.2 · 在线挂载嵌入页",
      summary: "在线挂载 + 嵌入页：外部播放器以 sandbox iframe 挂载。",
      description: [
        "**验收点：在线挂载 · 嵌入页**",
        "",
        "- 播放区应为 16:9 的 sandbox iframe（不是原生播放器）",
        "- 详情信息里「播放方式」应显示「嵌入页」",
        "- 底部提示应写「嵌入页」并给「前往来源」链接",
      ].join("\n"),
      categorySlug: "music",
      tagSlugs: ["ost", "piano"],
      meta: {
        source: "mount",
        mode: "embed",
        url: EMBED_AUDIO_URL,
        provider: "网易云音乐",
        artist: "云村电台",
        album: "外链播放器演示",
        duration: "4:15",
        license: "",
        note: "演示数据：嵌入页音源，第三方播放器 iframe",
        downloads: [],
      },
      counts: { view: 1180, like: 92, fav: 38 },
      publishedAt: daysAgo(2, 15),
    },
    {
      slug: `${SLUG_PREFIX}music-file-local`,
      type: "MUSIC",
      title: "站内托管音频 · 上传文件",
      summary: "上传文件 + 站内托管：原生播放，可直接下载原件。",
      description: [
        "**验收点：上传文件 · 站内托管**",
        "",
        "- 播放区为原生 `<audio>`，地址是站内 `/uploads/demo-av/...`",
        "- 播放区下方应出现「下载音频」按钮 + 「站内托管，可直接下载原件」",
        "- 下载清单里也有一条同名文件（走统一登录墙与下载计数）",
        "- 「艺术家 / 时长」取自文件本身（ID3 标签 + 帧头估算）",
      ].join("\n"),
      categorySlug: "music",
      tagSlugs: ["ost"],
      meta: {
        source: "file",
        mode: "direct",
        url: localAudioUrl,
        artist: audioMeta.artist ?? "SoundHelix",
        album: audioMeta.album ?? "Demo Sessions",
        duration: audioDuration,
        license: "CC BY 4.0",
        note: "演示数据：文件上传后落站内存储",
        downloads: [
          {
            name: LOCAL_AUDIO_KEY.split("/").pop(),
            kind: localAudio ? "file" : "link",
            url: localAudioUrl,
            size: localAudio ? humanSize(localAudio.size) : undefined,
          },
        ],
      },
      counts: { view: 864, like: 61, fav: 27 },
      publishedAt: daysAgo(3, 11),
    },
    {
      slug: `${SLUG_PREFIX}video-mount-direct`,
      type: "VIDEO",
      title: "样片 · 在线挂载直链 1080p",
      summary: "在线挂载 + 直链：浏览器原生视频播放器。",
      description: [
        "**验收点：在线挂载 · 直链播放**",
        "",
        "- 播放区应为原生 `<video>`（16:9，黑底描边），可播可拖进度",
        "- 信息行应显示时长 / 画质 / 来源平台",
        "- 底部提示：「外链直链」，本站不托管 +「前往来源」",
        "- 卡片角标应为视频图标（红色）",
      ].join("\n"),
      categorySlug: "video",
      tagSlugs: ["sample-clip"],
      meta: {
        source: "mount",
        mode: "direct",
        url: extVideo?.url ?? LOCAL_VIDEO_SRC[0].url,
        provider: "外链直链",
        resolution: extVideo?.resolution ?? "720p",
        duration: extVideo?.duration ?? "0:10",
        license: "CC BY 4.0",
        note: "演示数据：直链视频，使用浏览器原生播放器",
        downloads: [],
      },
      counts: { view: 3120, like: 241, fav: 96 },
      publishedAt: daysAgo(4, 19),
    },
    {
      slug: `${SLUG_PREFIX}video-mount-embed`,
      type: "VIDEO",
      title: "B站嵌入 · 在线挂载嵌入页",
      summary: "在线挂载 + 嵌入页：B站播放器以 sandbox iframe 挂载。",
      description: [
        "**验收点：在线挂载 · 嵌入页**",
        "",
        "- 播放区应为 16:9 sandbox iframe（放行播放脚本，禁止 top 导航与弹窗）",
        "- 「播放方式」显示「嵌入页」，来源平台显示 B站",
        "- 底部提示写「嵌入页」并给「前往来源」链接",
      ].join("\n"),
      categorySlug: "video",
      tagSlugs: ["sample-clip"],
      meta: {
        source: "mount",
        mode: "embed",
        url: EMBED_VIDEO_URL,
        provider: "B站",
        resolution: "1080p",
        duration: "3:20",
        license: "",
        note: "演示数据：嵌入页视频，第三方播放器 iframe",
        downloads: [],
      },
      counts: { view: 1876, like: 133, fav: 58 },
      publishedAt: daysAgo(5, 16),
    },
    {
      slug: `${SLUG_PREFIX}video-file-local`,
      type: "VIDEO",
      title: "站内托管视频 · 上传文件",
      summary: "上传文件 + 站内托管：原生播放，可直接下载原件。",
      description: [
        "**验收点：上传文件 · 站内托管**",
        "",
        "- 播放区为原生 `<video>`，地址是站内 `/uploads/demo-av/...`",
        "- 播放区下方应出现「下载视频」按钮 + 「站内托管，可直接下载原件」",
        "- 下载清单里也有一条同名文件",
      ].join("\n"),
      categorySlug: "video",
      tagSlugs: ["sample-clip"],
      meta: {
        source: "file",
        mode: "direct",
        url: localVideoUrl,
        resolution: videoSource.resolution,
        duration: videoSource.duration,
        license: "CC BY 4.0",
        note: "演示数据：文件上传后落站内存储",
        downloads: [
          {
            name: LOCAL_VIDEO_KEY.split("/").pop(),
            kind: localVideo ? "file" : "link",
            url: localVideoUrl,
            size: localVideo ? humanSize(localVideo.size) : undefined,
          },
        ],
      },
      counts: { view: 1544, like: 108, fav: 44 },
      publishedAt: daysAgo(6, 13),
    },
    {
      slug: `${SLUG_PREFIX}video-no-source`,
      type: "VIDEO",
      title: "空态演示 · 未提供播放来源",
      summary: "meta 里没有播放地址时的兜底展示。",
      description: [
        "**验收点：缺少播放来源的兜底**",
        "",
        "- 播放区应显示虚线框「作者未提供播放来源」",
        "- 不应出现空播放器、也不应报错",
      ].join("\n"),
      categorySlug: "video",
      tagSlugs: ["sample-clip"],
      meta: { source: "mount", mode: "direct", url: "", license: "", downloads: [] },
      counts: { view: 320, like: 18, fav: 5 },
      publishedAt: daysAgo(7, 10),
    },
  ];

  // —— 先删后建：重跑即刷新 ——
  if (demoResources.length > 0) {
    await prisma.resource.deleteMany({ where: { id: { in: demoResources.map((r) => r.id) } } });
    console.log(`♻️  已清理旧的 ${demoResources.length} 条演示资源`);
  }

  console.log(`写入 ${items.length} 条演示资源（作者：${author.username}）…`);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const cover = covers[i % covers.length];
    const r = await prisma.resource.create({
      data: {
        slug: it.slug,
        title: it.title,
        summary: it.summary,
        description: it.description,
        type: it.type,
        status: "PUBLISHED",
        categoryId: catId.get(it.categorySlug) ?? null,
        authorId: author.id,
        meta: JSON.stringify(it.meta),
        viewCount: it.counts.view,
        likeCount: it.counts.like,
        favoriteCount: it.counts.fav,
        commentCount: 0,
        downloadCount: 0,
        createdAt: it.publishedAt,
        publishedAt: it.publishedAt,
      },
    });
    const media = await prisma.media.create({
      data: {
        resourceId: r.id,
        kind: "COVER",
        storageKey: cover.storageKey,
        mime: cover.mime,
        fileName: cover.storageKey.split("/").pop() ?? null,
        status: "READY",
        sort: 0,
      },
    });
    await prisma.resource.update({ where: { id: r.id }, data: { coverMediaId: media.id } });
    for (const t of it.tagSlugs) {
      const id = tagId.get(t);
      if (!id) continue;
      await prisma.tagOnResource.create({ data: { resourceId: r.id, tagId: id } });
      await prisma.tag.update({ where: { id }, data: { count: { increment: 1 } } });
    }
    try {
      await syncResourceSearch(r.id);
    } catch (e) {
      console.log(`   ⚠ 搜索索引同步失败（不影响页面展示）：${(e as Error).message}`);
    }
    console.log(`   ✓ ${it.type.padEnd(5)} /resources/${it.slug}`);
  }

  console.log("\n完成。可用下面这些入口验收：");
  console.log("  /browse?type=MUSIC     音乐类型页签");
  console.log("  /browse?type=VIDEO     视频类型页签");
  for (const it of items) console.log(`  /resources/${it.slug}`);
  console.log(`\n清理：npx tsx prisma/seed-av-demo.ts --clean`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
