// 缓存标签注册表 —— 跨请求数据缓存（unstable_cache）失效的唯一事实来源。
//
// 为什么单独一个文件：标签是「写入方」与「读取方」之间唯一的约定。散落的字符串字面量
// 一旦拼错，失效就**静默失灵**（缓存永远不更新），而且不报错、只表现为「后台改了前台不变」。
// 所以集中定义、只从这里取。
//
// 用法：
//   读取方  unstable_cache(fn, ["key"], { tags: [CACHE_TAGS.siteSetting], revalidate: N })
//   写入方  revalidateTag(CACHE_TAGS.siteSetting, "max")
//
// 注意 revalidateTag 在 Next 16 必须传第二个参数（profile）；"max" = 一年窗口，
// 走 stale-while-revalidate：用户永远拿到内容，后台刷新。单参数形式已废弃。

export const CACHE_TAGS = {
  /**
   * 站点级配置（`SiteSetting` 表）。
   * 覆盖 getSeoConfig / getTheme / getRuntimeConfig 三个读取器。
   *
   * 这三个键的写入点全仓库只有 4 处，改配置后必须调用
   * `revalidateTag(CACHE_TAGS.siteSetting, "max")`：
   *   - src/lib/actions/seo.ts            （SEO_KEY）
   *   - src/lib/actions/site.ts           （THEME_KEY）
   *   - src/lib/site.ts                   （THEME_KEY 首建）
   *   - src/lib/actions/runtime-config.ts （RUNTIME_CONFIG_KEY）
   */
  siteSetting: "site-setting",

  /**
   * 分类列表（`Category` 表），对应 `getCategories()`。
   *
   * 为什么这个能上标签：写入面**可枚举且极低频**——运行时代码里只有
   * `src/lib/actions/taxonomy.ts` 的 create/update/delete 三个动作会写 Category，
   * 且三者都收口在同一个 `revalidateAll()` 里；其余只有 seed 脚本（部署期手动执行）。
   * 分类改错是会立刻被看见的（后台新建了分类，前台导航里没有），所以必须精确失效，
   * 不能只靠 TTL 兜。
   */
  categories: "categories",
} as const;

/**
 * 配置类缓存的兜底存活时间（秒）。
 *
 * 标签失效是主手段，这个 TTL 只是保险丝：万一存在没覆盖到的写入路径
 * （直接改库、跑 seed 脚本、以后新增的写入点漏挂标签），最坏也只是这么多秒后自愈，
 * 而不是永久脏数据。调短更保守但更费库，调长反之。
 */
export const CONFIG_CACHE_REVALIDATE_SECONDS = 300;

/**
 * 分类列表的兜底存活时间（秒）。
 *
 * 分类是「几乎不变」的数据（管理员偶尔增删），主失效手段是上面的 `categories` 标签。
 * 这个 TTL 只用来兜住没覆盖到的写入路径（seed 脚本、直连改库），所以取得比配置类更长；
 * 即便真漏了，最坏 10 分钟后也会自愈。
 */
export const CATEGORY_CACHE_REVALIDATE_SECONDS = 600;

/**
 * 高写入频率内容的存活时间（秒）—— 用于**刻意不做标签失效**的那批查询：
 * 最新评论、热门标签、人气创作者。它们的写入点散布在前台各业务流里
 * （发一条评论、上架/编辑一个资源都会改动），既无法枚举也难以保证不漏挂。
 *
 * 对这类数据，正确的策略不是「挂一堆标签假装精确」，而是**承认它天生近似**：
 *   - 「最新评论」慢 1 分钟 = 无所谓；
 *   - 「热门标签」的 count ±1 几乎不改变 top N 排序 = 用户不可感知；
 *   - 「人气创作者」的在线点本就基于 5 分钟窗口（`ONLINE_WINDOW_MS`），
 *     多滞后 1 分钟仍在同一量级。
 *
 * 反过来，如果给它们挂标签却漏掉某个写入点，就会变成**永久脏数据**——
 * 比「明确只用 TTL」危险得多。所以这里选择诚实的近似。
 */
export const HOT_CACHE_REVALIDATE_SECONDS = 60;

/**
 * 全站统计数字的存活时间（秒），对应 `getHomeStats()`。
 *
 * 资源数/用户数/下载量/浏览量的写入点是**每一次浏览和下载**——按次失效完全不可行，
 * 只能靠时间。首页那几个大数字本身就是「大概齐」的社会证明，5 分钟前的数字不影响观感。
 */
export const STATS_CACHE_REVALIDATE_SECONDS = 300;
