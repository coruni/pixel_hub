// 站内附件体积回填（server-only，import prisma，禁止被 client 组件引用）。
//
// 问题：清单行里的 `size` 是「写入当时」记下的展示文本。只要那条行不是经向导上传落下的
// （历史数据、作者手粘的 /od/ 站内路径、早期版本没有 size 字段的记录），它就一直空着——
// 表现为详情页同一份清单里「一个附件有大小、另一个没有」，而作者在发布页根本没有大小输入框
// （GAME/ARTICLE 的清单编辑器都关掉 showSize），无从补填。
//
// 事实是体积一直躺在 Media 表里：Media.storageKey 就是清单里存的那个 URL。所以这里按 URL
// 反查一次，读取（详情页）与写入（发布/改稿）两侧都过同一层 —— 存量数据不用改库即刻正确，
// 新写入的数据则是自愈的。
//
// 成本：只在「确实有站内附件缺 size」时才发一次 findMany；外链（http(s)://）永远不触发查询，
// 网盘外链的体积本来也无从得知，照旧不显示。
import { prisma } from "@/lib/db/prisma";
import { formatBytes } from "@/lib/format";
import type { ResourceMetaOutput } from "@/lib/meta";

type Loose = { url?: unknown; size?: unknown };

/** 站内引用（/od/… 云盘、/uploads/… 本地盘、其它 /xxx 自描述路径）按 URL 判定，不信 kind —— */
/** 历史数据里 kind 有脏值，URL 才是事实（与 lib/meta.ts 的 downloadKindOf 同一口径）。 */
function isStationRef(row: unknown): boolean {
  return (
    !!row &&
    typeof row === "object" &&
    typeof (row as Loose).url === "string" &&
    (row as Loose).url!.toString().trim().startsWith("/")
  );
}

function lacksSize(row: unknown): boolean {
  if (!isStationRef(row)) return false;
  const s = (row as Loose).size;
  return typeof s !== "string" || s.trim() === "";
}

/**
 * Media.storageKey 的取值形态：local 驱动落的是 `/uploads/<key>`，云盘落 `/od/…`，
 * s3 落完整 URL —— 都是清单里 URL 的原样。只对 `/uploads/` 再试一次去前缀的相对 key，
 * 兜住更早期「库中存相对 key」的记录。
 */
function keyVariants(url: string): string[] {
  const u = url.trim().replace(/\\/g, "/");
  if (!u.startsWith("/uploads/")) return [u];
  return [u, u.slice("/uploads/".length)];
}

/**
 * 补齐清单行里缺失的站内附件体积，返回新数组（原始数组与对象不被改动）。
 * 行结构保持原样，只可能多出 / 覆盖一个 `size` 字段。
 */
export async function fillDownloadSizes(rows: unknown[]): Promise<unknown[]> {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const urls = [
    ...new Set(
      rows
        .filter(lacksSize)
        .map((r) => String((r as Loose).url).trim())
        .filter(Boolean),
    ),
  ];
  if (urls.length === 0) return rows;

  const medias = await prisma.media.findMany({
    where: { storageKey: { in: [...new Set(urls.flatMap(keyVariants))] } },
    select: { storageKey: true, size: true },
  });
  const bytesOf = new Map<string, number>();
  for (const m of medias)
    if (typeof m.size === "number" && m.size > 0) bytesOf.set(m.storageKey, m.size);
  if (bytesOf.size === 0) return rows;

  return rows.map((r) => {
    if (!lacksSize(r)) return r;
    const url = String((r as Loose).url).trim();
    const bytes = keyVariants(url)
      .map((k) => bytesOf.get(k))
      .find((v) => typeof v === "number");
    if (typeof bytes !== "number") return r;
    return { ...(r as object), size: formatBytes(bytes) };
  });
}

/**
 * 详情页 / 预览用的整包回填：把所有清单行（含 IMAGE 的旧单条 `download`）补齐体积。
 * 只碰下载相关的字段，其余 meta 原样透传。一次额外的 `fillDownloadSizes` 调用合并不了
 * 也没必要 —— 单条 download 与 downloads 不同时存在（见 download-panel 的分发顺序）。
 */
export async function withDownloadSizes(meta: ResourceMetaOutput): Promise<ResourceMetaOutput> {
  const downloads = (await fillDownloadSizes(meta.downloads)) as typeof meta.downloads;
  if (meta.kind !== "IMAGE") return { ...meta, downloads };
  if (meta.download.mode === "none" || !meta.download.url || meta.download.size)
    return { ...meta, downloads };
  const [filled] = (await fillDownloadSizes([meta.download])) as [typeof meta.download];
  return { ...meta, downloads, download: filled };
}
