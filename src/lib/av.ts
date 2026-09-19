// 音视频（音乐 / 视频）资源的共享纯逻辑 —— 不依赖 server / node，发布向导（client）、
// 详情页（server）与上传接口（route handler）共用同一套判定，避免三处各写一份后缀表。
//
// 两个正交维度：
//   source：mount=在线挂载（只存 URL）｜file=上传文件（落存储 / 云盘后回填站内路径）
//   mode  ：direct=直链，用原生 <audio>/<video> 播放｜embed=嵌入页，用 iframe 挂载
// 判定只做「建议」不做封死：直链能不能原生播由扩展名推断，用户可在向导里手动改。

export type AvKind = "audio" | "video";
export type AvSource = "mount" | "file";
export type AvMode = "direct" | "embed";

/** 音乐可上传/可直连的音频后缀（全小写不带点） */
export const AUDIO_EXTS = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus"] as const;

/** 视频可上传/可直连的视频后缀（不含流媒体分片，本站不拼 HLS/DASH） */
export const VIDEO_EXTS = ["mp4", "m4v", "webm", "mov", "mkv", "ogv"] as const;

export const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
};

export const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
};

/** 资源类型 → 音视频种类；非音视频返回 null（其余类型不应调用本模块其他函数） */
export function avKindOf(type: string): AvKind | null {
  const t = type.toUpperCase();
  if (t === "MUSIC") return "audio";
  if (t === "VIDEO") return "video";
  return null;
}

export function isAvType(type: string): boolean {
  return avKindOf(type) !== null;
}

/** 该种类允许的后缀集合 */
export function avExtsFor(kind: AvKind): readonly string[] {
  return kind === "audio" ? AUDIO_EXTS : VIDEO_EXTS;
}

export function avClassFor(kind: AvKind): string {
  return kind === "audio" ? "音频" : "视频";
}

/** `<input accept>`：音频走 audio/*，视频走 video/*（浏览器据此过滤文件选择器） */
export function avAcceptAttr(kind: AvKind): string {
  return kind === "audio" ? "audio/*,.m4a,.flac,.opus" : "video/*,.mkv";
}

/** 文件名或 URL 的后缀（小写、不带点）；取路径末段，忽略 ?query 与 #hash */
export function extOf(nameOrUrl: string): string {
  const path = (nameOrUrl ?? "").split(/[?#]/)[0] ?? "";
  return path.match(/\.([A-Za-z0-9]{1,10})$/)?.[1]?.toLowerCase() ?? "";
}

/** 站内路径（/uploads/…、/od/…）与 http(s) 外链都算「可播放地址」 */
export function isAvUrl(v: string): boolean {
  return /^https?:\/\/.+/i.test(v) || /^\/[^/].*$/i.test(v);
}

/**
 * 是否为「直链音视频」——扩展名在对应后缀表内（不传 kind 时两种都认）。
 * 命中 → 用原生播放器；未命中 → 视为嵌入页（iframe）。仅建议，UI 可覆盖。
 */
export function isDirectAvUrl(url: string, kind?: AvKind): boolean {
  const ext = extOf(url);
  if (!ext) return false;
  const exts = kind ? avExtsFor(kind) : [...AUDIO_EXTS, ...VIDEO_EXTS];
  return (exts as readonly string[]).includes(ext);
}

/** 后缀 → 音视频种类；两者都不是返回 null。用于「内联播放还是直接下载」这类按文件判定的场景 */
export function avKindByExt(nameOrUrl: string): AvKind | null {
  const ext = extOf(nameOrUrl);
  if ((AUDIO_EXTS as readonly string[]).includes(ext)) return "audio";
  if ((VIDEO_EXTS as readonly string[]).includes(ext)) return "video";
  return null;
}

/** 依据 URL 推定播放形态；空地址时沿用 direct（避免未填就跳到 iframe） */
export function suggestMode(url: string, kind?: AvKind): AvMode {
  if (!url.trim()) return "direct";
  return isDirectAvUrl(url, kind) ? "direct" : "embed";
}

/** 上传/播放时给存储与播放器的 MIME；未知后缀回退 audio/video 通用类型 */
export function avMimeOf(nameOrUrl: string, kind: AvKind): string {
  const ext = extOf(nameOrUrl);
  const table = kind === "audio" ? AUDIO_MIME : VIDEO_MIME;
  if (table[ext]) return table[ext];
  return kind === "audio" ? "audio/*" : "video/*";
}

/** 上传提示文案：允许后缀样例 */
export function avExtsSample(kind: AvKind, n = 6): string {
  const exts = avExtsFor(kind);
  const head = exts.slice(0, n).join("/");
  return exts.length > n ? `${head} 等` : head;
}

/** 「挂载在线」输入框占位提示 */
export function avMountPlaceholder(kind: AvKind): string {
  return kind === "audio"
    ? "https://…/song.mp3 或 音频页面地址（网易云 / 播客 / 网盘直链）"
    : "https://…/clip.mp4 或 视频页面地址（B站 / YouTube / 网盘直链）";
}

/** 嵌入页 iframe 的 sandbox：允许播放脚本，但禁止 top 导航、弹窗与表单提交 */
export const AV_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-presentation";
