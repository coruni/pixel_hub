// 展示格式化（中文）
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, "")}k`;
  if (n < 100000000) return `${(n / 10000).toFixed(n % 10000 === 0 ? 0 : 1).replace(/\.0$/, "")}万`;
  return `${(n / 100000000).toFixed(1).replace(/\.0$/, "")}亿`;
}

/**
 * 字节数 → 展示文本（B / KB / MB / GB，非整单位保留一位小数）。
 * 附件体积的唯一口径：上传回执、编辑器里的清单行、详情页下载清单都用它，
 * 任何一处改了量纲，同一份文件在三处就会显示成不同大小。
 * 非法值（null / NaN / 负数）返回空串，调用方据此走「不显示」而不是「显示 0 B」。
 */
export function formatBytes(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "刚刚";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} 天前`;
  return dayKey(d);
}

/** 本地日期 key（YYYY-MM-DD）：Visit.day 落库、按天聚合与 timeAgo 的日期显示共用 */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 本地月份 key（YYYY-MM）：下载月度配额、结算归属期、收入归属期共用。
 *  用本地时区而非 UTC —— 「自然月」对站长的含义是本机日历月，不是 UTC 月。 */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 创作者卡片的副信息行。`metric` 必须来自 `getTopCreators()` 的同口径返回值 ——
 * 标签随 sort/period 变化，写死「粉丝」会在贡献分榜上把分数说成粉丝数。
 * 首页 creators 板块与侧栏 creators 组件共用，避免两处文案漂移。
 */
export function creatorMetaText(
  resources: number,
  metric: number,
  sort: "followers" | "points",
  period: "all" | "week" | "month",
): string {
  const unit = sort === "points" ? "贡献分" : "粉丝";
  const prefix = period === "all" ? "" : period === "week" ? "近 7 天 " : "近 30 天 ";
  return `${resources} 作品 · ${prefix}${formatCount(metric)} ${unit}`;
}
