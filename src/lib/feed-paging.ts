/**
 * Feed 列表每页条数（单一事实来源）。
 *
 * FeedBrowser 的服务端首屏与 FeedInfinite 的客户端追页必须共用同一个值：
 * getFeed 的取数是 `skip = (page - 1) * pageSize`，两处 pageSize 不一致时，
 * 第 2 页的 offset 与首屏实际条数错位，边界卡片会在两页之间重复出现。
 */
export const FEED_PAGE_SIZE = 32;
