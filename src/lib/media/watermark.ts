// 图片水印：文字 → SVG 覆盖层 → sharp composite。
//
// ── 字体：直接用前台那一份 Fusion Pixel ──────────────────────────────────────────
// 前台字体是 public/fonts/fusion-pixel-12px-proportional-zh_hans.woff2（见 globals.css 的
// @font-face）。这里用 fontkit 取出字形轮廓、把文字渲成 SVG <path>，**不走 fontconfig、
// 也不需要往系统里装字体**，原因：
//   ① fontconfig 索引不了 woff2；要装就得同时装 Windows 本机与 Linux 容器，两边版本必然漂移；
//   ② 轮廓模式与部署环境无关 —— 同一份字体文件 ⇒ 本机与线上逐像素一致，并且顺带消掉了
//      「容器里没有字体、librsvg 静默输出空白」这一整类事故（见 buildTextOverlay 的注释）。
// 只有用户输入里出现站点字体覆盖不到的字符（emoji、未收录的罕用字…）时才回退到
// <text> + fontconfig，那时才需要镜像里装字体，见 watermarkAvailable()。
//
// 落点用 `gravity: "southeast"`（sharp 自己算），因此不依赖调用方给的图片高宽是否精确；
// 宽高只用于两件事：字号缩放，以及「覆盖层不得高于底图」的前置判断。
import fs from "node:fs";
import path from "node:path";
import * as fontkitModule from "fontkit";
import sharp from "sharp";
import { WATERMARK_TEXT_MAX } from "@/lib/upload-config";

/** sharp 管道实例类型（sharp 用 export = 导出，取不到命名类型） */
type SharpPipe = ReturnType<typeof sharp>;

/**
 * fontkit 的具名导出面（本项目只用 create）。
 * 不能用 `import fontkit from "fontkit"`：它的 ESM 产物没有 default 导出，裸 default 导入在
 * Turbopack 下直接编译失败。而 CJS 产物把 create 挂在 module.exports 上、ESM 产物挂在命名空间上，
 * 所以这里 `default ?? 命名空间` 各取一次 —— 打包器切文件、以及被标成外部包后走 Node require，
 * 三种形态都能取到同一个函数。
 */
type FontkitApi = { create(source: Uint8Array | ArrayBuffer): unknown };
const fontkit = ((fontkitModule as unknown as { default?: FontkitApi }).default ??
  fontkitModule) as unknown as FontkitApi;

/** 水印内容。位置与样式固定（右下角、深色填充 + 浅色描边），只让用户决定「写什么」 */
export type WatermarkSpec = { text: string };

/** 覆盖层的两种绘制方式：path = 站点字体轮廓；text = SVG `<text>` 交给 fontconfig 回退 */
export type OverlayMode = "path" | "text";

/** 覆盖层产物 */
type Overlay = { input: Buffer; height: number; fontSize: number; mode: OverlayMode };

/**
 * 回退字族栈，交给 fontconfig 逐级回退。刻意不加引号：带空格的字族名在 pango 里可以直接裸写，
 * 而加了引号反而要在 SVG 属性里多一层转义。
 */
const FALLBACK_FONT =
  "Noto Sans CJK SC, Microsoft YaHei, PingFang SC, Hiragino Sans GB, Arial, sans-serif";

/** 站点字体的字宽（单位：字体设计单位，1em = unitsPerEm）。见下方 siteFont() 的类型收窄 */
type FontkitFont = {
  unitsPerEm: number;
  glyphForCodePoint(codePoint: number): { id: number };
  layout(text: string): {
    glyphs: { id: number; path: { toSVG(): string } }[];
    positions: { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }[];
    advanceWidth: number;
  };
};

const XML_ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESC[c] ?? c);

// ────────────────────────────── 站点字体 ──────────────────────────────

/** undefined = 尚未尝试加载；null = 加载失败（失败结果也要缓存，别每次上传都重读文件） */
let cachedFont: FontkitFont | null | undefined;

/**
 * 懒加载站点字体。**同步**：`fontkit.create` 与 `readFileSync` 都是同步的，
 * 这样 buildOverlay / applyWatermark 能保持同步签名，两条上传链路都不用改。
 */
function siteFont(): FontkitFont | null {
  if (cachedFont !== undefined) return cachedFont;
  try {
    // 路径写成字面量：产物追踪只对静态路径生效，拼出来的路径会退化成「追踪整个项目」
    const file = path.join(
      process.cwd(),
      "public/fonts/fusion-pixel-12px-proportional-zh_hans.woff2",
    );
    cachedFont = fontkit.create(fs.readFileSync(file)) as unknown as FontkitFont;
  } catch (err) {
    cachedFont = null;
    console.error("[watermark] 站点字体加载失败，水印回退系统字体：", err);
  }
  return cachedFont;
}

/** 站点字体是否覆盖文本里的每个可见字符（空格与控制字符本来就没有轮廓，不算缺字） */
function coversAll(font: FontkitFont, text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x20 || cp === 0x7f) continue;
    if (font.glyphForCodePoint(cp).id === 0) return false;
  }
  return true;
}

// ────────────────────────────── 几何 ──────────────────────────────

/** 字号随图宽缩放：14~96 是可读区间，再小缩略图上看不清、再大原图上像贴纸 */
export function watermarkFontSize(imageWidth: number): number {
  return Math.max(14, Math.min(96, Math.round(imageWidth * 0.028)));
}

/** 覆盖层尺寸（供「放不放得下」的前置判断用） */
export function overlayHeight(imageWidth: number): number {
  return Math.round(watermarkFontSize(imageWidth) * 2.2);
}

const padXOf = (fontSize: number) => Math.round(fontSize * 0.85);

// ────────────────────────────── 轮廓模式（主路径） ──────────────────────────────

/**
 * 用站点字体的字形轮廓拼出覆盖层。
 *
 * 与 `<text>` 版的关键差别：**字宽是算出来的，不是估的**。所以文字比图片还宽时不是把左边裁掉
 * （`text-anchor="end"` 的旧行为会静默截断），而是整体缩到放得下 —— 水印是署名，宁可小一点，
 * 也不能缺字。
 */
function buildPathOverlay(text: string, imageWidth: number, font: FontkitFont): Overlay {
  const width0 = Math.max(1, imageWidth);
  const units = font.unitsPerEm;
  const run = font.layout(text);
  // 与字号无关的「字宽 = 多少个 em」。Fusion Pixel 的 CJK 是 1em、拉丁是 0.5em，
  // 中英混排用固定系数估必然偏，这里直接取字体自己的 advance。
  const emWidth = run.advanceWidth / units;

  // 放不下就整体缩字。迭代两次即可收敛到亚像素：字号与内边距同比例缩，第二次只是补掉
  // padX 取整带来的零点几像素偏差。**不设字号下限** —— 下限只会让「缩不下」变成「裁字」，
  // 而裁掉一半的署名比一行小字更糟。
  const base = watermarkFontSize(width0);
  let fontSize = base;
  for (let i = 0; i < 2; i++) {
    const need = emWidth * fontSize + padXOf(fontSize) * 2;
    if (need <= width0) break;
    fontSize *= width0 / need;
  }

  const padX = padXOf(fontSize);
  const padY = Math.round(fontSize * 0.7);
  const height = Math.round(fontSize * 2.2);
  const textWidth = emWidth * fontSize;
  const width = Math.max(
    Math.ceil(fontSize * 2),
    Math.min(width0, Math.ceil(textWidth + padX * 2)),
  );
  const baseline = height - padY;
  const originX = Math.max(0, width - padX - textWidth);

  // 字形轮廓的坐标是「字体设计单位、y 轴向上」，这里只在 <g> 上做一次 scale(s, -s) 翻到
  // SVG 的 y 轴向下，各字形的平移量就仍然按原始字体单位写，不必逐点换算。
  const scale = fontSize / units;
  const glyphs: string[] = [];
  let pen = 0;
  for (let i = 0; i < run.glyphs.length; i++) {
    const d = run.glyphs[i].path.toSVG();
    const pos = run.positions[i];
    if (d) {
      glyphs.push(`<path transform="translate(${pen + pos.xOffset} ${-pos.yOffset})" d="${d}"/>`);
    }
    pen += pos.xAdvance;
  }
  const glyphData = glyphs.join("");

  // 两趟绘制：**先浅色描边、再压深色填充**（字幕的经典做法，不是反过来）。
  // 反过来的「白字 + 深描边」在暖白底上只剩一圈细描边、字心与底色同色 —— 整块字看起来是空心的、
  // 基本读不出来，而站点默认底色恰好就是暖白。深填充 + 浅描边则在亮底上靠深色字心、在暗底上靠浅色
  // 外圈，两端都立得住，不必感知图片亮度。
  // 用两趟绘制而不是 paint-order：paint-order 在 librsvg 上支持不稳。
  //
  // 描边宽度写的是**字体单位**（0.16em），因为它会跟着 <g> 上的 scale 一起缩到目标字号。
  const group =
    `transform="translate(${originX.toFixed(2)} ${baseline}) scale(${scale.toFixed(6)} ${(-scale).toFixed(6)})"`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<g ${group} fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="${(units * 0.16).toFixed(2)}" stroke-linejoin="round">${glyphData}</g>` +
    `<g ${group} fill="#000000" fill-opacity="0.72">${glyphData}</g>` +
    `</svg>`;

  return { input: Buffer.from(svg), height, fontSize, mode: "path" };
}

// ────────────────────────── 回退模式（系统字体） ──────────────────────────

/**
 * `<text>` 版覆盖层：宽度只能按字数估（每字符 1.05em，CJK ≈ 1em、拉丁 ≈ 0.5em）。
 * 刻意往大估：`text-anchor="end"` 靠右对齐，估小了裁掉的永远是左边。
 * 仅在站点字体缺字时使用。
 */
function buildTextOverlay(text: string, imageWidth: number): Overlay {
  const fontSize = watermarkFontSize(imageWidth);
  const padX = padXOf(fontSize);
  const padY = Math.round(fontSize * 0.7);
  const height = Math.round(fontSize * 2.2);
  const est = Math.ceil(text.length * fontSize * 1.05) + padX * 2;
  const width = Math.max(Math.ceil(fontSize * 2), Math.min(est, Math.max(1, imageWidth)));
  const baseline = height - padY;
  const x = width - padX;
  const common =
    `x="${x}" y="${baseline}" text-anchor="end" font-family="${FALLBACK_FONT}" font-size="${fontSize}"`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<text ${common} fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="${(fontSize * 0.16).toFixed(2)}" stroke-linejoin="round">${esc(text)}</text>` +
    `<text ${common} fill="#000000" fill-opacity="0.72">${esc(text)}</text>` +
    `</svg>`;
  return { input: Buffer.from(svg), height, fontSize, mode: "text" };
}

/** 生成覆盖层：站点字体覆盖得住就用轮廓，否则回退系统字体 */
export function buildOverlay(text: string, imageWidth: number): Overlay {
  const font = siteFont();
  if (font && coversAll(font, text)) return buildPathOverlay(text, imageWidth, font);
  return buildTextOverlay(text, imageWidth);
}

// ────────────────────────────── 复合 ──────────────────────────────

/**
 * 给 sharp 管道加水印。**必须在 compressWith / 格式编码之前调用**（复合要发生在编码之前）。
 *
 * `baseHeight` 只用于「覆盖层放不放得下」：宽高比极端的图（长条、全景）覆盖层会高于底图，
 * 直接 composite 会被 sharp 拒绝并让整次上传失败 —— 这里改为静默跳过该尺寸的水印。
 * 宁可这张图没水印，也不能让用户的图传不上去。
 */
export function applyWatermark(
  pipe: SharpPipe,
  spec: WatermarkSpec | null,
  imageWidth: number,
  baseHeight: number,
): SharpPipe {
  if (!spec?.text) return pipe;
  const { input, height } = buildOverlay(spec.text, imageWidth);
  if (baseHeight <= height + 4) return pipe;
  return pipe.composite([{ input, gravity: "southeast" }]);
}

// ────────────────────────── 环境自检（仅回退模式需要） ──────────────────────────

/**
 * fontconfig 自检：无 fontconfig / 无中文字体的环境里，librsvg 渲染 SVG 文本**不报错**，
 * 只是产出空白 —— 症状是「开关打开了、页面上什么都没有」，日志里看不出任何异常。
 * 首次用到时渲染一小块文本并数非透明像素，把这种静默失败变成显式降级 + 一条可检索的 error。
 * 轮廓模式（主路径）不依赖 fontconfig，因此这项检查只在需要系统字体兜底时才跑。
 */
let fontProbe: Promise<boolean> | null = null;

function probeFontSupport(): Promise<boolean> {
  const { input } = buildTextOverlay("水印", 400);
  return sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer()
    .then((buf) => {
      for (let i = 3; i < buf.length; i += 4) if (buf[i] !== 0) return true;
      return false;
    })
    .catch(() => false);
}

/** 回退模式（SVG `<text>` + 系统字体）在当前环境是否可用 */
export function watermarkAvailable(): Promise<boolean> {
  fontProbe ??= probeFontSupport().then((ok) => {
    if (!ok) {
      console.error(
        "[watermark] 当前环境渲染不出 SVG 文字（缺 fontconfig 或中文字体），已跳过水印。" +
          "Linux 镜像需安装 fontconfig 与中文字体，见 Dockerfile。",
      );
    }
    return ok;
  });
  return fontProbe;
}

// ────────────────────────── 用户偏好 → 水印 ──────────────────────────

/** 默认水印文字：@用户名。刻意不带站点名 —— 缩略图上字数一多就糊了 */
export function defaultWatermarkText(username: string): string {
  return `@${username}`;
}

/** 把用户配置规整成水印文字：自定义优先，否则回退 @用户名；压平空白并截断 */
export function resolveWatermarkText(username: string, custom?: string | null): string {
  const t = (custom ?? "").trim().replace(/\s+/g, " ");
  return (t || defaultWatermarkText(username)).slice(0, WATERMARK_TEXT_MAX);
}

/**
 * 用户偏好 → 水印规格。**上传链路（图集 / 评论附图）统一走这里**，
 * 这样「开关、文字兜底、字体可用性」三件事只有一份判断，不会出现某条链路漏检而静默出白图。
 *
 * 站点字体覆盖得住就走轮廓模式（永远可用，与运行环境无关）；覆盖不住才需要 fontconfig 兜底，
 * 环境不支持时整条放弃 —— 宁可不打水印，也不能在图上印一排空白。
 */
export async function resolveWatermark(
  enabled: boolean,
  username: string,
  custom?: string | null,
): Promise<WatermarkSpec | null> {
  if (!enabled) return null;
  const text = resolveWatermarkText(username, custom);
  const font = siteFont();
  if (font && coversAll(font, text)) return { text };
  if (!(await watermarkAvailable())) return null;
  return { text };
}
