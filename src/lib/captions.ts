// 「字幕 / 歌词」的解析与表单序列化纯逻辑 —— 详情页播放器（client）与发布向导共用。
// 服务端 action 只用它的 JSON 解析 / 序列化，不引 node，因此浏览器与 RSC 两侧都能 import。
//
// 数据形状：字幕文本**不落存储、不发额外请求**，直接内联在资源 meta 里
//（主来源在 meta.caption，各曲目/分P 在自己的 meta.tracks[].caption，**一项一份**）。
// 这么定有三个理由：
//   ① `<track>` 只吃 WebVTT，srt / lrc 必须自己解析，本来就走不上「交给浏览器拉 src」那条路；
//   ② 站内文件的云盘引用（/od/…）由网关 302 到 Graph 的预鉴权链接，那个响应不带 CORS 头，
//      客户端 fetch 必失败；内联则完全绕开，也不必为此新开一个「本站转发字节」的代理路由；
//   ③ 字幕文本很小（一部电影的字幕约 20–80KB），随详情页一次带下来比多一次往返更划算。
//
// 为什么不用原生 `<track>`：除了只认 vtt，原生 cue 的样式还活在 UA shadow 里 —— 字号、
// 描边、背景全不可控，跟全站「直角 + 像素字体」的语言直接冲突。所以五种格式统一解析成
// `{ start, end, text }`，渲染全部自绘，视频叠层与音频歌词板共用同一份数据。

/** 支持的格式。<br>不做：smi(SAMI) / ttml / dfxp（同类，用户极少）/ sub+idx（图形字幕，要 OCR） */
export const CAPTION_FORMATS = ["vtt", "srt", "lrc", "ass", "txt"] as const;
export type CaptionFormat = (typeof CAPTION_FORMATS)[number];

export function isCaptionFormat(v: unknown): v is CaptionFormat {
  return typeof v === "string" && (CAPTION_FORMATS as readonly string[]).includes(v);
}

/** 格式 → 人话（向导下拉、详情页格式标签） */
export const CAPTION_FORMAT_LABEL: Record<CaptionFormat, string> = {
  vtt: "WebVTT (.vtt)",
  srt: "SubRip (.srt)",
  lrc: "LRC 歌词 (.lrc)",
  ass: "ASS / SSA (.ass)",
  txt: "纯文本 (.txt)",
};

/** 单份字幕的文本上限（字符）。一部电影的字幕约 20–80KB，留一倍余量足够 */
export const AV_CAPTION_TEXT_MAX = 160_000;

/** 单份字幕的行数上限（渲染保护）：超出部分直接丢，避免异常数据把播放器卡死 */
export const CAPTION_CUE_MAX = 3000;

/**
 * 一份资源可挂的**字幕文本总量**上限（字符）。
 *
 * 口径沿革：字幕曾是一个「整份资源共用、最多 6 条」的数组（6 × 160K = 960K），
 * 现在改成**每个播放项各带一份**（见 meta.ts 的 avTrackSchema.caption），
 * 条目数上限跟着 tracks 走（60），但**总体积必须继续卡住** —— 60 × 160K = 9.6M 字符的 meta
 * 会让详情页每次多带近 10MB。这里沿用改造前的总量口径，能力不缩水也不膨胀。
 */
export const AV_CAPTION_TOTAL_MAX = 960_000;

/**
 * 一套字幕的编辑形状（向导的行、meta 里的 caption；两边形状必须一致，靠 action 的赋值互校）。
 *
 * 没有 `label`：字幕已与播放项一一对应（一个曲目/分P 一份），
 * 「多语言 / 多版本」的区分名失去意义 —— 切换靠切播放项，不靠切轨。
 */
export type CaptionDraft = { format: CaptionFormat; text: string };

// ---------- 表单受控序列化（与 downloads / tracks 同款） ----------

/**
 * 解析隐藏字段里的单份字幕 JSON；坏 JSON / 形状不对一律返回 null，绝不抛错。
 * 返回 null 表示「这一项没有字幕」，与「解析失败」在调用侧同义 —— 都不该拦提交。
 */
export function parseCaptionDraft(raw: string | null | undefined): CaptionDraft | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text : "";
    if (!text.trim()) return null;
    return { format: isCaptionFormat(o.format) ? o.format : "srt", text };
  } catch {
    return null;
  }
}

/** 序列化单份字幕：没文本时输出空串（宿主据此判断「该项无字幕」） */
export function serializeCaptionDraft(c: CaptionDraft | null | undefined): string {
  if (!c || !c.text.trim()) return "";
  return JSON.stringify({ format: c.format, text: c.text });
}


// ---------- 格式识别 ----------

/** 文件名 / 地址的后缀 → 格式；认不出返回 null（交给内容嗅探或让用户手选） */
export function captionFormatOfName(nameOrUrl: string): CaptionFormat | null {
  const ext = (nameOrUrl ?? "").split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!ext) return null;
  if (ext === "ssa") return "ass";
  if (ext === "webvtt") return "vtt";
  return isCaptionFormat(ext) ? ext : null;
}

/**
 * 内容嗅探：作者没选格式（或选错）时的兜底。只看头 4KB —— 别为判格式把整份字幕扫一遍。
 * 注意顺序：vtt / ass / srt 的特征串比较硬，lrc 的 `[mm:ss]` 最松，放最后。
 */
export function sniffCaptionFormat(text: string): CaptionFormat {
  const head = (text ?? "").slice(0, 4096);
  if (/^\s*WEBVTT/.test(head)) return "vtt";
  if (/^\s*\[Events\]/im.test(head) || /^\s*Dialogue\s*:/im.test(head)) return "ass";
  // 带箭头的时间行（srt 与 vtt 都有），区分点在于 vtt 已在上一步被认走
  if (/^\s*\d+\s*$\n\s*\d{1,3}:\d{1,2}:\d{1,2}[.,]\d{1,3}\s*-->/m.test(head)) return "srt";
  if (/\d{1,3}:\d{1,2}:\d{1,2}[.,]\d{1,3}\s*-->/.test(head)) return "srt";
  if (/^\s*\[(ti|ar|al|by|offset|re|ve|length)\s*:/im.test(head)) return "lrc";
  if (/\[(?:\d{1,3}:)?\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(head)) return "lrc";
  return "txt";
}

// ---------- 解析 ----------

/** 一条带时间轴的文本行 */
export type CaptionCue = { start: number; end: number; text: string };

/** 解析结果：`cues` 有时间轴（跟播），`lines` 没有（静态展示）。两者不会同时非空 */
export type ParsedCaption = { cues: CaptionCue[]; lines: string[] };

/** 没有字幕时的稳定空结果（共享引用，避免每次渲染都新建对象把 memo 打穿） */
export const NO_CAPTION: ParsedCaption = { cues: [], lines: [] };

/** 末条 / 缺 end 的 cue 的默认时长（秒） */
const CUE_TAIL_SEC = 8;

/**
 * 时间戳 → 秒。兼容四种写法（按冒号段数与小数位数定标）：
 *   `1:02:03.456`（vtt/srt，h:m:s + 毫秒）｜ `02:03.456`（srt 简写，m:s）
 *   `[00:12.34]`（lrc，m:s + 厘秒）      ｜ `0:00:01.00`（ass，h:m:s + 厘秒）
 * 小数位按位数定标：1 位 = 十分秒、2 位 = 厘秒、3 位 = 毫秒 —— ass 的厘秒就靠这条规则对上。
 */
function parseTimestamp(raw: string): number | null {
  const parts = (raw ?? "").trim().split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const tail = parts[parts.length - 1].match(/^(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!tail) return null;
  const heads = parts.slice(0, -1).map((p) => Number(p));
  if (heads.some((n) => !Number.isInteger(n) || n < 0)) return null;
  const frac = tail[2] ? Number(tail[2]) / 10 ** tail[2].length : 0;
  const sec = Number(tail[1]) + frac;
  if (parts.length === 3) return heads[0] * 3600 + heads[1] * 60 + sec;
  return heads[0] * 60 + sec;
}

/** 剥掉行内标记，并把转义还原成可读文本（srt/vtt 的 `<i>`、ass 的 `{\an8}` 与 `\N`） */
function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "") // srt/vtt 的内联标签：<i> <b> <font color=…> <c.class>
    .replace(/\{[^}]*\}/g, "") // ass 的覆盖块 {\an8 \pos(…) \k20}
    .replace(/\\[Nn]/g, "\n") // ass 的换行
    .replace(/\\h/g, " ") // ass 的硬空格
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** vtt 的时间行可以在时间后跟设置串（`00:00:01.000 --> 00:00:04.000 align:start`），去掉它 */
function timeTokenOf(v: string): string {
  return v.trim().split(/\s+/)[0] ?? "";
}

/**
 * srt / vtt：逐行扫，遇到 `-->` 就是一条 cue 的头，其后到空行（或下一条时间行）之间是文本。
 * 不按空行切块是因为 srt 偶尔缺块间空行，切块会把两条 cue 揉在一起。
 */
function parseTimecoded(src: string): CaptionCue[] {
  const lines = src.split("\n");
  const cues: CaptionCue[] = [];
  let i = 0;
  while (i < lines.length && cues.length < CAPTION_CUE_MAX) {
    const m = lines[i].match(/^(.*?)-->\s*(.*)$/);
    if (!m) {
      // 序号行、cue 标识行、NOTE / STYLE / REGION 块都在这儿跳过
      i += 1;
      continue;
    }
    const start = parseTimestamp(timeTokenOf(m[1]));
    const end = parseTimestamp(timeTokenOf(m[2]));
    i += 1;
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].includes("-->")) {
      body.push(lines[i]);
      i += 1;
    }
    if (start === null) continue;
    const text = cleanText(body.join("\n"));
    if (text) cues.push({ start, end: end !== null && end > start ? end : start + CUE_TAIL_SEC, text });
  }
  return cues;
}

/**
 * lrc：一行可挂多个 `[mm:ss.xx]` 标签（副歌复用），文本取最后一个标签之后的部分。
 * 支持 `[offset:±ms]`（正值 = 歌词整体延后），其余 `[ti:] [ar:]` 类元数据直接跳过。
 * 增强型 lrc 的行内时间戳 `<00:12.34>` 只剥不解析 —— 保留它会和行首标签重复计一遍。
 */
function parseLrc(src: string): CaptionCue[] {
  const raw: CaptionCue[] = [];
  let offsetSec = 0;
  for (const line of src.split("\n")) {
    if (raw.length >= CAPTION_CUE_MAX) break;
    const meta = line.match(/^\s*\[(ti|ar|al|by|re|ve|length|offset)\s*:\s*(.*?)\]\s*$/i);
    if (meta) {
      if (meta[1].toLowerCase() === "offset") {
        const n = Number(meta[2].trim());
        if (Number.isFinite(n)) offsetSec = n / 1000;
      }
      continue;
    }
    const stamps = [...line.matchAll(/\[(\d{1,3}(?::\d{1,2}){1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (stamps.length === 0) continue;
    const body = line
      .slice(line.lastIndexOf("]") + 1)
      .replace(/<\d{1,3}(?::\d{1,2}){1,2}(?:[.:]\d{1,3})?>/g, "");
    const text = cleanText(body);
    if (!text) continue;
    for (const s of stamps) {
      const t = parseTimestamp(s[1]);
      if (t === null) continue;
      raw.push({ start: Math.max(0, t + offsetSec), end: 0, text });
    }
  }
  return raw;
}

/**
 * ass / ssa：只取 Events 段里 Dialogue 行的 Start / End / Text。
 * 字段位置不写死 —— 按同段上方的 `Format:` 行动态定位，因为不同工具的字段顺序并不一致。
 * 文本是最后一个字段且内部可以含逗号，所以用 slice 而不是按索引取单个。
 */
function parseAss(src: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let at = { start: 1, end: 2, text: 9 }; // ASS 的默认 Format 顺序
  for (const line of src.split("\n")) {
    if (cues.length >= CAPTION_CUE_MAX) break;
    const fmt = line.match(/^\s*Format\s*:\s*(.+)$/i);
    if (fmt) {
      const names = fmt[1].split(",").map((s) => s.trim().toLowerCase());
      const start = names.indexOf("start");
      const end = names.indexOf("end");
      const text = names.indexOf("text");
      if (start >= 0 && end >= 0 && text >= 0) at = { start, end, text };
      continue;
    }
    const dlg = line.match(/^\s*Dialogue\s*:\s*(.+)$/i);
    if (!dlg) continue;
    const parts = dlg[1].split(",");
    if (parts.length <= at.text) continue;
    const start = parseTimestamp(parts[at.start]);
    const end = parseTimestamp(parts[at.end]);
    const text = cleanText(parts.slice(at.text).join(","));
    if (start === null || !text) continue;
    cues.push({ start, end: end !== null && end > start ? end : start + CUE_TAIL_SEC, text });
  }
  return cues;
}

/** 无时间轴的静态行（txt 正文），同样设行数上限 */
function plainLines(src: string): string[] {
  return src
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, CAPTION_CUE_MAX);
}

/**
 * 排序去重 + 补齐 end。
 * end 的规则：**只收紧、不拉长** —— srt 里两条 cue 之间的空档是「字幕消失」，拉长会让它一直挂着；
 * 而 lrc 给的占位 end 必然超过下一条的 start，正好被收紧成「唱到下一句为止」。
 */
function normalizeCues(cues: CaptionCue[]): CaptionCue[] {
  const sorted = cues
    .filter((c) => Number.isFinite(c.start) && c.start >= 0)
    .sort((a, b) => a.start - b.start)
    .slice(0, CAPTION_CUE_MAX);
  const out: CaptionCue[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    // 同一时刻重复出现（lrc 多标签落在同一秒、或时间轴被截断到同一点）→ 合并成一行
    if (prev && Math.abs(prev.start - c.start) < 0.02) {
      if (!prev.text.includes(c.text)) prev.text = `${prev.text}\n${c.text}`;
      continue;
    }
    out.push({ ...c });
  }
  for (let i = 0; i < out.length; i += 1) {
    const next = out[i + 1];
    const limit = next ? next.start : out[i].start + CUE_TAIL_SEC;
    if (!(out[i].end > out[i].start) || out[i].end > limit) out[i].end = limit;
  }
  return out;
}

/**
 * 主入口：解析一份字幕文本。
 * 时间轴**整份都没解析出来**时（例如把 txt 当 srt 传进来）退回静态文本 —— 总比播放器上一片空白好。
 */
export function parseCaption(text: string, format: CaptionFormat): ParsedCaption {
  const src = (text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!src.trim()) return { cues: [], lines: [] };
  if (format === "txt") return { cues: [], lines: plainLines(src) };
  const cues =
    format === "lrc" ? parseLrc(src) : format === "ass" ? parseAss(src) : parseTimecoded(src);
  const normalized = normalizeCues(cues);
  if (normalized.length === 0) return { cues: [], lines: plainLines(src) };
  return { cues: normalized, lines: [] };
}

/**
 * 二分找「此刻该显示哪一行」。落在空档（srt 的间隙、播到末条之后）返回 -1 —— 字幕该消失。
 * 用二分而不是线性扫：cue 上限 3000，timeupdate 每秒会来好几次，线性扫在末尾最亏。
 */
export function activeCueIndex(cues: CaptionCue[], time: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (hit < 0) return -1;
  return time < cues[hit].end ? hit : -1;
}

/** 秒 → `12:34` / `1:02:03`；给「字幕时长」这类摘要文本用 */
export function captionClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "--:--";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 解析结果的一句话摘要（向导里展示「已载入什么」，作者据此确认格式没选错） */
export function captionSummary(p: ParsedCaption): string {
  if (p.cues.length > 0) {
    const last = p.cues[p.cues.length - 1];
    return `${p.cues.length} 行，覆盖到 ${captionClock(last.end)}`;
  }
  return `${p.lines.length} 行文本（无时间轴，只作静态歌词）`;
}
