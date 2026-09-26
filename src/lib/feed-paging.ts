/**
 * Feed 列表每页条数（单一事实来源）。
 *
 * FeedBrowser 的服务端首屏与 FeedInfinite 的客户端追页必须共用同一个值。
 */
export const FEED_PAGE_SIZE = 32;

/**
 * keyset（游标）分页的游标：指向「上一页最后一条」在排序里的位置。
 *
 * 为什么不用 offset：`skip = (page-1)*pageSize` 在追页期间只要有新内容插入或计数更新，
 * 后续页的窗口就会整体位移 —— 表现为重复卡片或漏卡片。FeedInfinite 目前靠
 * 「按 id 去重 + 整页都重复就收尾」兜住重复，但漏掉的那些是无解的。
 * 游标分页把「从哪继续」钉在数据本身，与前面有多少条无关。
 *
 * 三个字段对应排序键，顺序固定为 [主排序键, publishedAt=null 的边界, id]：
 * - `id`：主排序键（publishedAt / likeCount / downloadCount）+ id 降序的组合位置
 * - `t`：上一页最后一条的 publishedAt（毫秒时间戳；null → publishedAt 为空）
 * - 主排序键的具体数值由 `k` 携带（likeCount / downloadCount；latest 排序不需要）
 *
 * 注意：`publishedAt` 在 Prisma 里可空，Postgres 的 `DESC` 默认 NULLS FIRST，
 * 而 `lt` 比较对 NULL 恒为 UNKNOWN —— 所以游标必须显式区分「已越过 null 区」，
 * 否则 publishedAt 为空的资源会在翻页时被整个跳过。
 */
export type FeedCursor = {
  /** 主排序键数值：popular → likeCount，downloads → downloadCount，latest 不使用 */
  k: number;
  /** 上一页最后一条的 publishedAt（毫秒时间戳），null 表示该条 publishedAt 为空 */
  t: number | null;
  /** 上一页最后一条的 id（同值决胜键） */
  id: string;
};

/**
 * 给 Feed 接口用的 cursor 参数校验/解析（server action 的入参是不可信输入）。
 * 结构不合法返回 null —— 调用方按「无游标 = 取第一页」处理，不报错。
 */
export function parseFeedCursor(raw: unknown): FeedCursor | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || !c.id || c.id.length > 64) return null;
  if (typeof c.k !== "number" || !Number.isFinite(c.k)) return null;
  if (c.t !== null && (typeof c.t !== "number" || !Number.isFinite(c.t))) return null;
  return { k: c.k, t: c.t as number | null, id: c.id };
}
