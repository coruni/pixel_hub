// 音视频（MUSIC / VIDEO）演示数据 —— 用于验收前台展示效果。
//
// 背景：库里 MUSIC / VIDEO 两条类型原本是 0 条，前台（/browse 的类型页签、资源详情页播放卡、
// 首页「为你推荐 / 精选内容」）没有任何音视频可看。本脚本灌一批覆盖「托管位置 × 播放形态 ×
// 单曲/多P × 字幕 × 边界」的资源，一次跑完就能把各分支都在真实页面上看到。
//
// 覆盖矩阵（meta 形状见 src/lib/meta.ts 的 avMetaSchema；**没有 source 字段**，
// 站内 / 外链由 URL 是否以 / 开头判定；音频没有嵌入页形态，mode 只对 VIDEO 有意义）：
//   1 音乐 · 外链直链            → 站内自绘播放器 + 外链「前往来源」
//   2 音乐 · 多曲目 + 每曲歌词    → 播放列表切曲 + 音频歌词板随之更换
//   3 音乐 · 站内托管            → 自绘播放器 + 「下载原件」+ 下载清单（走统一登录墙/计数）
//   4 视频 · 外链直链 + 字幕      → 自绘播放器 + 画面底部字幕叠层
//   5 视频 · 嵌入页（B站）        → sandbox iframe + 「嵌入页字幕不显示」提示
//   6 视频 · 站内托管 + 多分P     → 列表切 P + 每 P 自己的字幕
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
import type { z } from "zod";
import { prisma } from "../src/lib/db/prisma";
import { avMetaSchema } from "../src/lib/meta";
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

/** 多曲目演示：三首不同的公开样例音频（主来源取第 1 首，其余进 tracks） */
const TRACK_URLS = [
  EXT_AUDIO_URL,
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
];

/** 三份演示歌词（LRC）。一首一份，随切曲一起换 */
const LRC_TEXTS = [
  [
    "[00:00.00]Pixel Radio · 曲目 1",
    "[00:04.20]像素色的清晨 屏幕还没醒",
    "[00:12.60]光标在闪 像一盏小灯",
    "[00:21.00]把音量拧到刚好 让整间屋子发声",
    "[00:34.50]这是今天的第一首歌",
  ].join("\n"),
  [
    "[00:00.00]Pixel Radio · 曲目 2",
    "[00:05.40]午后的风 从窗口斜着进来",
    "[00:14.80]旧唱片转得慢 灰尘在光里浮",
    "[00:26.10]别急着按下一首",
    "[00:38.70]让这一段多待一会儿",
  ].join("\n"),
  [
    "[00:00.00]Pixel Radio · 曲目 3",
    "[00:06.00]深夜电台 只剩下一个人听",
    "[00:17.30]信号穿过雨 音质有点毛",
    "[00:29.90]但正是这层毛边 让歌变得可信",
    "[00:44.20]晚安 明天见",
  ].join("\n"),
];

/** 视频嵌入页地址（实测无 X-Frame-Options，可被 sandbox iframe 挂载） */
const EMBED_VIDEO_URL =
  "https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7&page=1&high_quality=1";

/** 演示字幕（SRT）—— 直链视频用，验证画面底部叠层 */
const SRT_TEXT = [
  "1",
  "00:00:01,000 --> 00:00:05,000",
  "像素样片 · 第一句字幕",
  "",
  "2",
  "00:00:05,500 --> 00:00:09,500",
  "字幕随播放进度切换",
].join("\n");

/** 演示字幕（WebVTT）—— 多分P 视频的第二 P 用，验证切 P 换字幕 */
const VTT_TEXT = [
  "WEBVTT",
  "",
  "00:00:01.000 --> 00:00:05.000",
  "第二 P · 自己的字幕",
  "",
  "00:00:05.500 --> 00:00:09.500",
  "切 P 会整体换掉",
].join("\n");

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

/** 站点存储 key 取末段当展示名（`a/b/c.mp3` → `c.mp3`）。不用 split().pop()：
 *  那个在 noUncheckedIndexedAccess 下是 string | undefined，而下载项名要求非空字符串 */
function baseName(key: string): string {
  const i = key.lastIndexOf("/");
  return i >= 0 ? key.slice(i + 1) : key;
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
  /**
   * 按 avMetaSchema 的**入参**类型约束，而不是 `Record<string, unknown>`：
   * 库里存的就是这份 JSON 原文，只有 schema 认得的键才会被 parseMeta 读出来，
   * 写错键名 / 多写一个键（zod 默认 strip）不会报错、页面只会静默降级成「未提供播放来源」。
   * 用入参类型就是为了让 tsc 在这里拦住。
   */
  meta: z.input<typeof avMetaSchema>;
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
      slug: `${SLUG_PREFIX}music-direct`,
      type: "MUSIC",
      title: "像素电台 Vol.1 · 外链直链",
      summary: "外链直链：站内自绘播放器，本站不托管文件。",
      description: [
        "**验收点：外链直链（单曲）**",
        "",
        "- 播放区应为站内自绘播放器（非 iframe、非原生 controls）",
        "- 顶部信息行：时长 / 格式 / 艺术家",
        "- 底部提示：以「外链直链」挂载，本站不托管 +「前往来源」链接",
        "- 卡片角标应为音乐图标（brand 色）",
      ].join("\n"),
      categorySlug: "music",
      tagSlugs: ["ost"],
      meta: {
        mode: "direct",
        title: "像素电台 Vol.1",
        url: EXT_AUDIO_URL,
        artist: "Pixel Radio",
        duration: "6:12",
        downloads: [],
      },
      counts: { view: 2431, like: 186, fav: 74 },
      publishedAt: daysAgo(1, 20),
    },
    {
      slug: `${SLUG_PREFIX}music-tracks-lrc`,
      type: "MUSIC",
      title: "像素电台 Vol.2 · 三首连播",
      summary: "多曲目 + 每曲一份 LRC 歌词：切曲即切歌词板。",
      description: [
        "**验收点：多曲目 + 歌词强相关**",
        "",
        "- 播放区顶部应显示「曲目 3 首」角标，并出现「歌词 3 项」角标",
        "- 控件行可上一首 / 下一首，列表里主来源是「曲目 1」",
        "- 歌词板随切曲整体更换（每首一份，不是共用一份）",
        "- 点歌词行可跳到该句时间点",
      ].join("\n"),
      categorySlug: "music",
      tagSlugs: ["ost", "piano"],
      meta: {
        mode: "direct",
        title: "第一轨 · 像素清晨",
        url: TRACK_URLS[0],
        artist: "Pixel Radio",
        duration: "6:12",
        caption: { format: "lrc", text: LRC_TEXTS[0] },
        tracks: [
          {
            title: "第二轨 · 午后慢转",
            url: TRACK_URLS[1],
            duration: "6:06",
            caption: { format: "lrc", text: LRC_TEXTS[1] },
          },
          {
            title: "第三轨 · 深夜电台",
            url: TRACK_URLS[2],
            duration: "6:34",
            caption: { format: "lrc", text: LRC_TEXTS[2] },
          },
        ],
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
        "**验收点：站内托管（音频）**",
        "",
        "- 播放区为自绘播放器，地址是站内 `/uploads/demo-av/...`",
        "- 播放器控件行内应出现「下载原件」图标按钮（站内路径才给）",
        "- 下载区清单里也有一条同名文件（走统一登录墙与下载计数）",
        "- 「艺术家 / 时长」取自文件本身（ID3 标签 + 帧头估算）",
      ].join("\n"),
      categorySlug: "music",
      tagSlugs: ["ost"],
      meta: {
        mode: "direct",
        title: "站内托管音频",
        url: localAudioUrl,
        artist: audioMeta.artist ?? "SoundHelix",
        duration: audioDuration,
        downloads: [
          {
            name: baseName(LOCAL_AUDIO_KEY),
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
      slug: `${SLUG_PREFIX}video-direct`,
      type: "VIDEO",
      title: "样片 · 直链 1080p + 字幕",
      summary: "外链直链：站内自绘播放器 + 画面底部字幕叠层。",
      description: [
        "**验收点：直链播放 + 字幕**",
        "",
        "- 播放区应为自绘播放器（16:9 黑底），可播可拖进度",
        "- 信息行应显示时长 / 格式 / 画质 / 「字幕 SRT」角标",
        "- 右上角字幕开关可切显隐；字幕压在画面底部、不挡点画面",
        "- 底部提示：「外链直链」，本站不托管 +「前往来源」",
      ].join("\n"),
      categorySlug: "video",
      tagSlugs: ["sample-clip"],
      meta: {
        mode: "direct",
        title: "样片 · 直链 1080p",
        url: extVideo?.url ?? LOCAL_VIDEO_SRC[0].url,
        resolution: extVideo?.resolution ?? "720p",
        duration: extVideo?.duration ?? "0:10",
        caption: { format: "srt", text: SRT_TEXT },
        downloads: [],
      },
      counts: { view: 3120, like: 241, fav: 96 },
      publishedAt: daysAgo(4, 19),
    },
    {
      slug: `${SLUG_PREFIX}video-embed`,
      type: "VIDEO",
      title: "B站嵌入 · 嵌入页播放",
      summary: "嵌入页：B站播放器以 sandbox iframe 挂载。",
      description: [
        "**验收点：嵌入页（仅视频有这个形态）**",
        "",
        "- 播放区应为 16:9 sandbox iframe（放行播放脚本，禁止 top 导航与弹窗）",
        "- 详情信息里「播放方式」显示「嵌入页」",
        "- 挂的字幕不生效：下方应有「字幕由来源站点控制」的提示",
      ].join("\n"),
      categorySlug: "video",
      tagSlugs: ["sample-clip"],
      meta: {
        mode: "embed",
        title: "B站演示视频",
        url: EMBED_VIDEO_URL,
        resolution: "1080p",
        duration: "3:20",
        caption: { format: "srt", text: SRT_TEXT },
        downloads: [],
      },
      counts: { view: 1876, like: 133, fav: 58 },
      publishedAt: daysAgo(5, 16),
    },
    {
      slug: `${SLUG_PREFIX}video-file-local-multi`,
      type: "VIDEO",
      title: "站内托管视频 · 多分P + 各P字幕",
      summary: "站内托管 + 多分P：切 P 换源，每 P 各自的字幕。",
      description: [
        "**验收点：站内托管 + 多分P**",
        "",
        "- 播放区为自绘播放器，地址是站内 `/uploads/demo-av/...`，控件行有「下载原件」",
        "- 顶部信息行应显示「分P 2 P」角标",
        "- 画面右上角有上一集 / 下一集 / 列表三个浮层按钮",
        "- 切到 P2 后字幕整体换掉（P1 用 SRT、P2 用 VTT），倍速与音量不应被重置",
      ].join("\n"),
      categorySlug: "video",
      tagSlugs: ["sample-clip"],
      meta: {
        mode: "direct",
        title: "第一段 · 站内托管",
        url: localVideoUrl,
        resolution: videoSource.resolution,
        duration: videoSource.duration,
        caption: { format: "srt", text: SRT_TEXT },
        tracks: [
          {
            title: "第二段 · 外链备选源",
            url: LOCAL_VIDEO_SRC[1].url,
            duration: LOCAL_VIDEO_SRC[1].duration,
            caption: { format: "vtt", text: VTT_TEXT },
          },
        ],
        downloads: [
          {
            name: baseName(LOCAL_VIDEO_KEY),
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
      meta: { mode: "direct", title: "", url: "", downloads: [] },
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
