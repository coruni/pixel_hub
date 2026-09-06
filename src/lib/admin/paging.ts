// 后台数据管理页（内容库 / 用户管理 / 媒体库）共用的分页与筛选参数工具。
// 三页都要求：默认每页 30 条、createdAt desc + id desc 稳定排序、翻页时保留全部筛选参数。

/** 后台列表每页条数 */
export const ADMIN_PAGE_SIZE = 30;

/**
 * 稳定排序：createdAt 相同时用 id 兜底。
 * 只按 createdAt 排序时，同秒创建的记录在 PG 里返回顺序不保证，翻页会重复/漏行。
 */
export const STABLE_NEWEST = [{ createdAt: "desc" }, { id: "desc" }] as const;

/**
 * 筛选条件 → querystring（忽略空值）。base 是当前筛选状态，over 覆盖分页等单值参数。
 * 用于分页链接与状态 chips，保证翻页/切状态时其余条件不丢。
 */
export function adminQuery(
  base: Record<string, string | undefined>,
  over: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
