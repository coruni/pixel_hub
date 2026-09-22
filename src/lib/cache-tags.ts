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
} as const;

/**
 * 配置类缓存的兜底存活时间（秒）。
 *
 * 标签失效是主手段，这个 TTL 只是保险丝：万一存在没覆盖到的写入路径
 * （直接改库、跑 seed 脚本、以后新增的写入点漏挂标签），最坏也只是这么多秒后自愈，
 * 而不是永久脏数据。调短更保守但更费库，调长反之。
 */
export const CONFIG_CACHE_REVALIDATE_SECONDS = 300;
