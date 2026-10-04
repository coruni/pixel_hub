// 图片去重指纹：**压缩前**原始上传字节的 sha256。
//
// 为什么不沿用附件那套「同一用户 + 同名 + 同大小」（见 app/api/upload/attachment/*）：
// 图片在落库前会被 sharp 重编码 —— 尺寸被缩到 ≤1600/480、质量按后台配置、格式可能换成 webp
// （见 media/process.ts / media/compress.ts），Media.size 记的是**压缩产物**的字节数，
// 与用户手上那个原文件不是一回事。同一张图两次上传，产物字节数可能只差几 KB，
// 换个编码器版本或元数据一变就完全不同 —— 靠 size 判定必然漏，这就是「重复上传检测失效」。
// 指纹取源字节：压不压缩、输出成什么格式都不影响判定。
//
// 命中后**复用已有存储对象、另建一条 Media 记录**，而不是把旧记录直接还回去：
// Media.resourceId / commentId 都是单值字段，跨资源复用同一条记录等于把图从上一个资源手里抢走。
// 代价是同一批 key 会被多条记录引用 —— 删文件前必须反查引用（见 actions/admin-media.ts 的
// purgeFiles），桶用量统计也必须按 key 去重（见 storage/bucket-usage.ts）。
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { mimeFromExt } from "@/lib/storage/mime";

/** 源字节指纹（十六进制 sha256） */
export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** 合法 sha256 指纹：64 位小写十六进制。用于校验客户端上传时随附的「压缩前源字节指纹」，
 *  收不到或格式非法时由服务端回退为「对收到字节取 sha256」。 */
export function isSha256Hex(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

/** 去重范围：图集（/api/upload）与评论附图（addCommentAction）各自一套压缩管线 */
export type DedupScope = "gallery" | "comment";

/** 可复用的记录：字段与 Media 行一一对应，null 一律落到 0 / 兜底值，避免往非空列写 null */
export type ReusableImage = {
  storageKey: string;
  bigKey: string | null;
  thumbKey: string | null;
  placeholder: string | null;
  width: number;
  height: number;
  size: number;
  mime: string;
  /** 输出扩展名（从 storageKey 末段解出），供调用方沿用原来的输出格式拼 fileName */
  ext: string;
};

/** 从存储 key / URL 取输出扩展名；取不到按 webp 兜底（未配置过其他格式时的默认输出） */
function extOfKey(key: string): string {
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(key);
  return (m?.[1] ?? "webp").toLowerCase();
}

/**
 * 查同一用户、同源字节、同管线的已完成记录；没有则返回 null。
 *
 * 只按 uploaderId 收窄而不是全局去重：既避免「A 上传的图被 B 复用」这种归属混乱，
 * 也让撤销（删除某用户媒体）不会牵连别人的内容。
 */
export async function findReusableImage(
  uploaderId: string,
  checksum: string,
  scope: DedupScope,
): Promise<ReusableImage | null> {
  const row = await prisma.media.findFirst({
    where: {
      uploaderId,
      checksum,
      status: "READY",
      kind: scope === "gallery" ? "GALLERY" : "ATTACHMENT",
      // 评论附图额外一道：ATTACHMENT 里还躺着下载源 / 音视频（原样落盘、没经过缩图，
      // 也没有 thumbKey），只认同样是「评论附图」出身、走过同一条压缩管线的行。
      ...(scope === "comment" ? { commentId: { not: null } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      storageKey: true,
      bigKey: true,
      thumbKey: true,
      placeholder: true,
      width: true,
      height: true,
      size: true,
      mime: true,
    },
  });
  if (!row?.storageKey) return null;

  const ext = extOfKey(row.storageKey);
  return {
    storageKey: row.storageKey,
    bigKey: row.bigKey,
    thumbKey: row.thumbKey,
    placeholder: row.placeholder,
    width: row.width ?? 0,
    height: row.height ?? 0,
    size: row.size ?? 0,
    mime: row.mime ?? mimeFromExt(ext) ?? "image/webp",
    ext,
  };
}
