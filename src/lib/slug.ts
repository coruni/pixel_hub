import { randomBytes } from "node:crypto";
import { pinyin } from "pinyin-pro";
import { prisma } from "@/lib/db/prisma";
import { translateToEnglish } from "@/lib/edge-translate";

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      // 中文与拉丁/数字保留，其余转连字符
      .replace(/[^a-z0-9一-龥]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
  );
}

// 汉字区间：基本区 + 扩展 A + 兼容区（含繁体）。只用于「这一串里有没有汉字」的判断。
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
// 连续的汉字算一段：拼音要按整段送进 pinyin-pro 才能正确分词（「更新」= geng-xin 而非 geng-xin 逐字猜）
const CJK_RUN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

/**
 * 保证**纯 ASCII** 的 slug：先把汉字整段转成无声调拼音，再走 slugify 归一。
 *
 * 与 `slugify` 的区别就一点：`slugify` 刻意保留汉字（历史行为），而落库的 slug 必须是 ASCII。
 * 汉字 slug 会带来两个真实故障：
 *  ① URL 变成 `/resources/pixel-hub%E6%9B%B4%E6%96%B0%E6%97%A5%E5%BF%97` 这种百分号编码态，人看不懂、外链易错；
 *  ② Next 的 `redirect()` 把带汉字的路径**原样**写进响应头（action 走 `x-action-redirect`，页面走 `location`），
 *    而 Node 的头值只接受 Latin-1 → `setHeader` 抛 `ERR_INVALID_CHAR`，资源已落库却整条响应失败。
 *
 * 拼音在 slugify **之前**做，避免生僻字/扩展区汉字先被当符号抹掉；末尾再抹一道非 ASCII，
 * 兜住「字符在 CJK 区间但 pinyin-pro 没有读音表」的漏网之鱼。
 */
export function asciiSlug(s: string): string {
  // 拼音串两侧补空格：中英相邻处才有词边界（「PixelHub更新日志」→ pixel-hub-geng-xin-ri-zhi
  // 而不是 pixel-hubgeng-xin-ri-zhi），slugify 会把连续非字母数字折成一个连字符，不会留下多余空格
  const py = CJK_RE.test(s)
    ? s.replace(CJK_RUN_RE, (run) => ` ${pinyin(run, { toneType: "none", type: "array" }).join(" ")} `)
    : s;
  return slugify(py)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * 中文名称 → 落库 slug 基串：**翻译 → 拼音 → 空串** 三级兜底。
 *
 * 中文名先经 Edge 翻译成英文（SEO 与外链友好）；接口不可用/超时时 `translateToEnglish` 返回 null，
 * 此时退回**拼音**而不是原文 —— 退回原文正是中文 slug 的来源（见 `asciiSlug` 的两条故障）。
 * 返回空串表示「名称里没有任何可用的字母/数字」（纯符号、纯 emoji），调用方自行用随机串兜底。
 */
export async function autoSlugBase(text: string): Promise<string> {
  const translated = await translateToEnglish(text);
  return asciiSlug(translated ?? text) || asciiSlug(text);
}

export function randomTail(len = 4): string {
  return randomBytes(len).toString("hex");
}

/**
 * 站内路径的动态段 → 数据库里的 slug。
 *
 * Next 16 的**页面**不对 dynamic params 做 percent 解码（route handler 才解），所以
 * `/tags/超能力` 这类路径到达 page 时 `params.slug` 仍是 `%E8%B6%85...`，直接查库必然落空
 * —— 表现为整站中文标签页 / 中文 slug 资源页 404。凡是用 params 里的 slug 查库的页面都要过这一道。
 * 解不开（非法转义）就原样返回；ASCII slug 不含 `%`，一次 includes 直接短路。
 */
export function decodeSlug(raw: string): string {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 生成可用唯一 slug（冲突自动追加短随机串）；入参已由 autoSlugBase 归一，这里只做 ASCII 与查重 */
export async function uniqueSlug(base: string): Promise<string> {
  const clean = asciiSlug(base) || "item";
  for (let i = 0; i < 3; i++) {
    const candidate = i === 0 ? clean : `${clean}-${randomTail()}`;
    const hit = await prisma.resource.findUnique({ where: { slug: candidate } });
    if (!hit) return candidate;
  }
  return `${clean}-${randomTail(6)}`;
}
