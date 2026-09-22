/**
 * Next.js 服务端缓存后端 —— Redis（自建 / 多实例部署用）
 *
 * 为什么需要它：Next 默认把服务端缓存（ISR 页面、路由处理器响应、next/image 优化结果、
 * 以及 `unstable_cache` 的数据）存在**每个进程自己的内存（50MB）+ 本地磁盘**里。
 * 单容器 + 持久盘时这没问题；一旦是多容器 / 无状态容器 / 需要重启不丢缓存，
 * 各实例各存一份，就会出现「A 实例改了、B 实例还在发旧内容」，且滚动发布后缓存全空。
 * 把缓存挪到 Redis 后，所有实例共享同一份，revalidateTag 也能跨实例生效。
 *
 * 注册方式（见 next.config.ts）：仅在配置了 REDIS_URL 时才注册本文件。
 * 未配置时 Next 走默认的进程内 + 磁盘缓存，行为与接入前完全一致。
 *
 * 注意与 `cacheHandlers`（复数）区分：
 *   - 本文件对应 `cacheHandler`（单数）→ 服务 ISR / 路由 / 图片 / unstable_cache
 *   - `cacheHandlers`（复数）只服务 `'use cache'` 指令，需要开 cacheComponents
 * 本项目当前用的是前者（未开 cacheComponents）。
 *
 * 降级策略（与仓库既有 rate-limit / register-code 同款约定）：
 *   Redis 不可用时透明回退进程内 Map，缓存自身不成为故障点；回退期间各实例缓存不共享。
 */
const { createClient } = require("redis");

/** 键前缀：避免与同一 Redis 上的其他业务键撞名 */
const PREFIX = process.env.CACHE_KEY_PREFIX || "pixelhub:next:";
/** 标签索引键前缀：tag:<tag> → 该标签下的缓存键集合 */
const TAG_PREFIX = PREFIX + "tag:";
/** 缓存条目的兜底存活时间（秒）。条目自身带 revalidate，这里只兜底防内存泄漏 */
const MAX_TTL_SECONDS = 60 * 60 * 24 * 7;
/** 回退 Map 的容量上限，超出按插入顺序淘汰最早的键 */
const FALLBACK_MAX_ENTRIES = 500;

// ---------------------------------------------------------------- 序列化

/**
 * 二进制安全的编码。
 * IncrementalCacheValue 里的 `html` / `pageData` / `postponed` / `buffer` 是 Buffer
 * 或嵌套着 Buffer；JSON.stringify 会把它们降级成 `{type:"Buffer",data:[…]}`，
 * 反序列化后不再是 Buffer，页面渲染会直接炸。所以显式打标 base64。
 */
function encode(value) {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __bin: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === "object") {
    // Date / RegExp 等在本层不会出现；普通对象逐键递归即可
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = encode(v);
    return out;
  }
  return value;
}

function decode(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value === "object") {
    if (typeof value.__bin === "string") return Buffer.from(value.__bin, "base64");
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decode(v);
    return out;
  }
  return value;
}

// ------------------------------------------------------- Redis / 降级存储

let client = null;
let connectPromise = null;
let warned = false;

/** 进程内降级存储（Redis 不可用期间使用） */
const fallback = new Map();

function warnOnce(err) {
  if (warned) return;
  warned = true;
  // 只提示一次，避免 Redis 抖动时刷满日志；不打印连接串等敏感信息
  console.warn(
    "[cache-handler] Redis 不可用，已回退进程内缓存（多实例下缓存不共享）：",
    err && err.message ? err.message : err,
  );
}

/**
 * 惰性建立连接。返回可用客户端，或 null（表示应走降级存储）。
 * 连接失败不抛错 —— 缓存故障绝不能阻断页面渲染。
 */
async function getClient() {
  const url = (process.env.REDIS_URL || "").trim();
  if (!url) return null;
  if (client && client.isReady) return client;
  if (!connectPromise) {
    connectPromise = (async () => {
      try {
        const c = createClient({ url });
        // 必须挂 error 监听：未捕获的 error 事件会让 Node 进程直接退出
        c.on("error", warnOnce);
        await c.connect();
        client = c;
        return c;
      } catch (e) {
        warnOnce(e);
        connectPromise = null;
        return null;
      }
    })();
  }
  try {
    return await connectPromise;
  } catch (e) {
    warnOnce(e);
    return null;
  }
}

function fallbackSet(key, entry) {
  if (fallback.size >= FALLBACK_MAX_ENTRIES && !fallback.has(key)) {
    const oldest = fallback.keys().next();
    if (!oldest.done) fallback.delete(oldest.value);
  }
  fallback.set(key, entry);
}

/** 条目是否已过 revalidate 窗口（过期即视为未命中） */
function isExpired(entry) {
  const revalidate = Number(entry && entry.revalidate);
  if (!Number.isFinite(revalidate) || revalidate <= 0) return false;
  return Date.now() > Number(entry.lastModified || 0) + revalidate * 1000;
}

// ---------------------------------------------------------------- Handler

module.exports = class CacheHandler {
  constructor(options) {
    this.options = options || {};
  }

  /**
   * 读取缓存。命中返回条目，未命中/过期/出错一律返回 null。
   * 必须自己吞掉异常：Next 不会包 try/catch，get 抛错会直接变成渲染错误。
   */
  async get(key) {
    const redisKey = PREFIX + key;
    try {
      const redis = await getClient();
      if (!redis) {
        const hit = fallback.get(redisKey);
        return hit && !isExpired(hit) ? hit : null;
      }
      const raw = await redis.get(redisKey);
      if (!raw) return null;
      const entry = decode(JSON.parse(raw));
      if (isExpired(entry)) return null;
      return entry;
    } catch (e) {
      warnOnce(e);
      const hit = fallback.get(redisKey);
      return hit && !isExpired(hit) ? hit : null;
    }
  }

  /**
   * 写入缓存。`data` 为 null 表示删除该键（Next 用它做失效）。
   * `ctx.tags` 用于建立标签索引，供 revalidateTag 反查。
   */
  async set(key, data, ctx) {
    const redisKey = PREFIX + key;
    try {
      const redis = await getClient();
      if (!redis) {
        if (data === null) fallback.delete(redisKey);
        else fallbackSet(redisKey, { ...data, lastModified: Date.now() });
        return;
      }

      if (data === null) {
        await redis.del(redisKey);
        return;
      }

      const entry = { ...data, lastModified: Date.now() };
      const revalidate = Number(entry.revalidate);
      const ttl =
        Number.isFinite(revalidate) && revalidate > 0
          ? Math.min(Math.ceil(revalidate * 1.5) + 60, MAX_TTL_SECONDS)
          : MAX_TTL_SECONDS;

      await redis.set(redisKey, JSON.stringify(encode(entry)), { EX: ttl });

      // 维护 标签 → 键 的反向索引（跨实例失效靠它）
      const tags = Array.isArray(ctx && ctx.tags) ? ctx.tags : [];
      for (const tag of tags) {
        const tagKey = TAG_PREFIX + tag;
        await redis.sAdd(tagKey, redisKey);
        await redis.expire(tagKey, ttl);
      }
    } catch (e) {
      warnOnce(e);
      if (data === null) fallback.delete(redisKey);
      else fallbackSet(redisKey, { ...data, lastModified: Date.now() });
    }
  }

  /**
   * 按标签失效。revalidatePath 会被 Next 折算成软标签后走到这里，
   * 所以仓库里现存的 revalidatePath 调用无需改动即可跨实例生效。
   */
  async revalidateTag(tags) {
    const list = Array.isArray(tags) ? tags : [tags];
    // 降级存储：无索引，只能整体清空（保守但正确）
    try {
      const redis = await getClient();
      if (!redis) {
        fallback.clear();
        return;
      }
      const pipeline = redis.multi();
      const keysToDrop = [];
      for (const tag of list) {
        const tagKey = TAG_PREFIX + tag;
        const members = await redis.sMembers(tagKey);
        for (const m of members) keysToDrop.push(m);
        pipeline.del(tagKey);
      }
      if (keysToDrop.length > 0) pipeline.del(keysToDrop);
      await pipeline.exec();
    } catch (e) {
      warnOnce(e);
      fallback.clear();
    }
  }

  /** 单请求内的临时缓存重置钩子；本实现不持有请求级状态，空实现即可 */
  async resetRequestCache() {}
};
