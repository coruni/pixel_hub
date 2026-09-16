// 音视频信息抓取：先读文件自带元数据（音频 ID3v2 / MP4 ilst），再退回媒体元素读时长与分辨率。
// 纯解析函数单独导出，便于在 node 里做无浏览器的用例校验。

export type AvProbe = {
  /** 展示用时长，如 3:42 / 1:02:33 */
  duration?: string;
  artist?: string;
  resolution?: string;
};

const SNIFF_BYTES = 512 * 1024;

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ---------------- ID3v2（mp3） ----------------

const ID3_FRAMES: Record<string, "artist" | "album" | "title"> = {
  TPE1: "artist",
  TALB: "album",
  TIT2: "title",
  TPE2: "artist",
};

function decodeId3Text(payload: Uint8Array): string {
  if (payload.length < 1) return "";
  const enc = payload[0]!;
  const body = payload.subarray(1);
  const clean = (s: string) => s.replace(/\0/g, "").trim();
  try {
    if (enc === 0) return clean(new TextDecoder("iso-8859-1").decode(body));
    if (enc === 3) return clean(new TextDecoder("utf-8").decode(body));
    if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe)
      return clean(new TextDecoder("utf-16le").decode(body.subarray(2)));
    if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff)
      return clean(new TextDecoder("utf-16be").decode(body.subarray(2)));
    return clean(new TextDecoder(enc === 2 ? "utf-16be" : "utf-16le").decode(body));
  } catch {
    return "";
  }
}

/** 只处理 ID3v2.3 / v2.4（v2.2 用 3 字节帧头，实际罕见） */
export function parseId3(buf: Uint8Array): { artist?: string; album?: string; title?: string } {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return {};
  const ver = buf[3]!;
  if (ver < 3 || ver > 4) return {};
  const out: { artist?: string; album?: string; title?: string } = {};
  let off = 10;
  while (off + 10 <= buf.length) {
    const id = String.fromCharCode(buf[off]!, buf[off + 1]!, buf[off + 2]!, buf[off + 3]!);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const r = buf.subarray(off + 4, off + 8);
    const size =
      ver === 4
        ? ((r[0]! & 0x7f) << 21) | ((r[1]! & 0x7f) << 14) | ((r[2]! & 0x7f) << 7) | (r[3]! & 0x7f)
        : (r[0]! << 24) | (r[1]! << 16) | (r[2]! << 8) | r[3]!;
    if (size <= 0 || off + 10 + size > buf.length) break;
    const key = ID3_FRAMES[id];
    if (key && !out[key]) out[key] = decodeId3Text(buf.subarray(off + 10, off + 10 + size));
    off += 10 + size;
  }
  return out;
}

// ---------------- MP4 / M4A ilst ----------------

const MP4_ATOMS: { sig: number[]; key: "artist" | "album" | "title" }[] = [
  { sig: [0xa9, 0x6e, 0x61, 0x6d], key: "title" }, // ©nam
  { sig: [0xa9, 0x41, 0x52, 0x54], key: "artist" }, // ©ART
  { sig: [0xa9, 0x61, 0x6c, 0x62], key: "album" }, // ©alb
];

export function parseMp4Tags(buf: Uint8Array): { artist?: string; album?: string; title?: string } {
  const out: { artist?: string; album?: string; title?: string } = {};
  for (const { sig, key } of MP4_ATOMS) {
    for (let i = 4; i + 20 < buf.length; i++) {
      if (
        buf[i] !== sig[0] ||
        buf[i + 1] !== sig[1] ||
        buf[i + 2] !== sig[2] ||
        buf[i + 3] !== sig[3]
      )
        continue;
      // 布局：[©xxx 名(4)][size(4)]['data'(4)][type(4)][locale(4)][payload]
      // 以 'data' 起点 D 为基准：D-4 = data 原子长度，D+12 = 文本起始，文本长度 = size - 16
      const d = i + 8;
      if (
        String.fromCharCode(buf[d]!, buf[d + 1]!, buf[d + 2]!, buf[d + 3]!) !== "data"
      )
        continue;
      const size =
        (buf[d - 4]! << 24) | (buf[d - 3]! << 16) | (buf[d - 2]! << 8) | buf[d - 1]!;
      if (size <= 16) break;
      const body = buf.subarray(d + 12, Math.min(d + size - 4, buf.length));
      const text = new TextDecoder("utf-8").decode(body).replace(/\0/g, "").trim();
      if (text) out[key] = text;
      break;
    }
  }
  return out;
}

// ---------------- 媒体元素（时长 / 分辨率） ----------------

function elementProbe(
  url: string,
  kind: "audio" | "video",
  timeoutMs = 12000,
): Promise<{ duration?: number; w?: number; h?: number }> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === "audio" ? "audio" : "video");
    let done = false;
    const finish = (v: { duration?: number; w?: number; h?: number }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      resolve(v);
    };
    const timer = setTimeout(() => finish({}), timeoutMs);
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () => {
      const d = el.duration;
      const v = el as HTMLVideoElement;
      finish({
        duration: Number.isFinite(d) && d > 0 ? d : undefined,
        w: v.videoWidth || undefined,
        h: v.videoHeight || undefined,
      });
    };
    el.onerror = () => finish({});
    el.src = url;
  });
}

/** 抓取本地文件：内嵌标签 + 时长/分辨率（用 objectURL，不受跨域限制） */
export async function probeFile(file: File, kind: "audio" | "video"): Promise<AvProbe> {
  const out: AvProbe = {};
  try {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const tags = { ...parseMp4Tags(head), ...(kind === "audio" ? parseId3(head) : {}) };
    if (tags.artist) out.artist = tags.artist;
  } catch {
    /* 元数据读不到不影响后续 */
  }
  const url = URL.createObjectURL(file);
  try {
    const m = await elementProbe(url, kind);
    if (m.duration) out.duration = formatDuration(m.duration);
    if (kind === "video" && m.w && m.h) out.resolution = `${m.w}×${m.h}`;
  } catch {
    /* 无法解析时保持空 */
  } finally {
    URL.revokeObjectURL(url);
  }
  return out;
}

/** 抓取在线直链（挂载模式）：只取时长 / 分辨率 */
export async function probeUrl(url: string, kind: "audio" | "video"): Promise<AvProbe> {
  const out: AvProbe = {};
  try {
    const m = await elementProbe(url, kind, 15000);
    if (m.duration) out.duration = formatDuration(m.duration);
    if (kind === "video" && m.w && m.h) out.resolution = `${m.w}×${m.h}`;
  } catch {
    /* 站点不允许读取时静默跳过 */
  }
  return out;
}

/** 把抓取结果压成一句提示，供上传成功文案使用 */
export function probeSummary(p: AvProbe): string {
  const parts = [
    p.duration ? `时长 ${p.duration}` : "",
    p.resolution ? `分辨率 ${p.resolution}` : "",
    p.artist ? `艺术家 ${p.artist}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? `已从文件读取：${parts.join("、")}` : "";
}
