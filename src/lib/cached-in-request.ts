// `unstable_cache` 的**请求上下文安全**包装。
//
// 【要解决的问题】
// Next.js 的 `unstable_cache` 在调用时会去取 `workAsyncStorage` 里的 incremental cache；
// 这个 storage 只在**某个请求（或预渲染）内**才有值。进程内的长驻代码——最典型的是
// `src/instrumentation.ts` 起的自动结算定时器——没有请求上下文，于是直接抛：
//
//   Invariant: incrementalCache missing in unstable_cache <callback>
//   （next/dist/server/web/spec-extension/unstable-cache.js:65）
//
// 本项目 9 处配置读取（theme / runtimeConfig / uploadLimits / seoConfig / homeSections /
// docMarkdown / incentive / categories / topTags）都建在 unstable_cache 上，而配置读取
// 又散布在结算、计分等后台路径里，所以这个异常会在定时器每轮 tick 时反复出现。
//
// 【为什么不在调用点 try/catch】
// 抛错发生在 `unstable_cache` 返回的那个 async 函数**被调用时**，不是构建时；而且它是
// Next 的 invariant 抛错，语义上说明「这个进程根本不该走缓存层」。在 9 个调用点各自
// 包一层 try/catch 既重复、又容易漏掉新增的配置项。收口在这里，一次修全站。
//
// 【行为】
// - 有请求上下文：与直接用 `unstable_cache` 完全一致，缓存、tag、revalidate 全部生效。
// - 无请求上下文（定时器 / 独立脚本 / 构建前的工具进程）：**这次调用**退化为直连数据库。
//   退化的只是「跨请求缓存」这一层，返回值与缓存命中时是同一条代码路径算出来的，语义不变。
//   下次进了请求上下文又恢复走缓存，不会把降级状态粘住。
//
// 【为什么不自己维护一张进程内缓存兜底】
// 那样要自己处理失效（后台保存后 revalidateTag 走的是 Next 的 tag 表，管不到自建 Map），
// 出现「配置改了但后台路径还读旧值」的隐性问题，比偶尔多查一次库危险得多。
// 无请求上下文的路径本身就是低频的（每 15 分钟一次 tick），直查的代价可以忽略。

import { unstable_cache } from "next/cache";

/** Next 的 invariant 抛错文案；匹配到才降级，其余错误照常抛 */
const MISSING_INCREMENTAL_CACHE = /incrementalCache missing in unstable_cache/;

/**
 * `unstable_cache` 的降级包装。
 *
 * @param cb      真正的取数函数（要缓存的那个）
 * @param keyParts 缓存键的固定部分
 * @param options  `{ tags, revalidate }`，与 unstable_cache 同义
 */
export function cachedInRequest<T>(
  cb: () => Promise<T>,
  keyParts: string[],
  options: { tags?: string[]; revalidate?: number | false },
): () => Promise<T> {
  const cached = unstable_cache(cb, keyParts, options);
  return async (): Promise<T> => {
    try {
      return await cached();
    } catch (e) {
      if (e instanceof Error && MISSING_INCREMENTAL_CACHE.test(e.message)) return await cb();
      throw e;
    }
  };
}

/**
 * 带参数的版本：用于 `unstable_cache(fn)` 里 fn 接收参数的场景（如按 doc key 取文档）。
 * 通过 `keys` 把参数映射成缓存键的一部分，避免不同参数互相污染。
 */
export function cachedInRequestWithArgs<A extends string, T>(
  cb: (arg: A) => Promise<T>,
  keyPrefix: string[],
  options: { tags?: string[]; revalidate?: number | false },
): (arg: A) => Promise<T> {
  return (arg: A): Promise<T> => {
    const cached = unstable_cache(() => cb(arg), [...keyPrefix, arg], options);
    return cached().catch((e: unknown) => {
      if (e instanceof Error && MISSING_INCREMENTAL_CACHE.test(e.message)) return cb(arg);
      throw e;
    });
  };
}
