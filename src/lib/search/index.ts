// 全文搜索后端（可插拔）：默认 PostgreSQL pg_trgm，可选 Elasticsearch。
//
// 配置来源（与站点其它运行配置一致，后台化 + 平滑迁移）：
//   后台「站点配置 → 搜索」页（SiteSetting site-runtime）优先；未设置项回退旧 .env
//   （SEARCH_ENGINE / ES_URL / ES_INDEX / ES_API_KEY / ES_USERNAME / ES_PASSWORD /
//    SEARCH_ES_ANALYZER / SEARCH_CANDIDATE_LIMIT）。.env 项全部迁到后台后即可删除对应行。
//   生效值解析集中见 runtime-config.ts（searchEngineName/esUrl/…），本文件只组装。
//
// 引擎切换即时性：每次调用按当前配置的 engine 类型取实例——类型变化会重建底层引擎，
// ES 的连接参数（地址/索引/认证）在每次请求时读取，后台改完保存即生效，无需重启。
//
// 架构约定：
//   - 引擎只负责「文本匹配 + 相关度排序」，产出候选 resource id（不感知 status/nsfw/分类等业务过滤）；
//   - 业务过滤、可见性、分页一致性由查询层（getFeed）在主表求交集时一并完成 → 引擎实现互不重复业务逻辑；
//   - 引擎文档覆盖 title/summary/description，仅索引文本；与 Resource 无物理删除（软删 REMOVED）配套，
//     删除/状态变化无需同步，靠查询层交集兜底；正文变化才需 syncResourceSearch。
import { prisma } from "../db/prisma";
import {
  getRuntimeConfig,
  getRuntimeConfigWithVersion,
  esAnalyzer,
  esApiKey,
  esIndex,
  esPassword,
  esUrl,
  esUsername,
  searchCandidateLimit,
  searchEngineName,
  type RuntimeConfig,
} from "../runtime-config";
import { createPgEngine } from "./pg";
import { createEsEngine } from "./es";

export type SearchDoc = {
  resourceId: string;
  title: string;
  summary: string | null;
  description: string;
  updatedAt: Date;
};

export interface SearchEngine {
  readonly kind: "postgres" | "elasticsearch";
  /** 全文候选：按相关度降序返回 resource id（至多 limit 个）。表/索引未就绪会抛错（调用方兜底）。 */
  search(q: string, opts: { limit: number }): Promise<{ ids: string[]; truncated: boolean }>;
  /** upsert 一条或多条文档（同 resourceId 覆盖）。 */
  upsert(docs: SearchDoc[]): Promise<void>;
  /** 按 resourceId 移除文档。 */
  remove(resourceIds: string[]): Promise<void>;
  /** 幂等确保底层表/索引就绪（创建引擎时执行一次）。 */
  ensure(): Promise<void>;
}

/** 一次解析出的搜索运行时配置（供引擎与查询层共同使用）。 */
export type SearchSettings = {
  engine: "postgres" | "elasticsearch";
  candidateLimit: number;
  es: {
    url: string;
    index: string;
    analyzer: string;
    auth?: { apiKey: string } | { username: string; password: string };
  };
};

export const SEARCH_TEXT_MAX = 20_000; // 单文档索引入库正文上限（防超大文章撑爆 trgm 索引）

/** 生成检索文本：三字段拼接后规整空白，限制长度。标题在前（pg_trgm 相关性天然偏向前文）。 */
export function buildSearchText(title: string, summary: string | null, description: string): string {
  return [title, summary ?? "", description]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_TEXT_MAX);
}

/** 读一行资源构造索引文档（供同步/重建共用，字段口径单一）。 */
export async function docOfResource(resourceId: string): Promise<SearchDoc | null> {
  const r = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, title: true, summary: true, description: true, updatedAt: true },
  });
  if (!r) return null;
  return {
    resourceId: r.id,
    title: r.title,
    summary: r.summary,
    description: r.description,
    updatedAt: r.updatedAt,
  };
}

/** 读取后台运行配置（react cache 请求级去重）；tsx 脚本等无 React 上下文时直读 DB 兜底。 */
async function loadRuntimeConfigSafe(): Promise<RuntimeConfig> {
  try {
    return await getRuntimeConfig();
  } catch {
    return (await getRuntimeConfigWithVersion()).config;
  }
}

/** 按当前后台配置解析搜索运行时（es 连接留空但选了 elasticsearch 时抛错，由调用方兜底）。 */
export async function loadSearchSettings(): Promise<SearchSettings> {
  const cfg = await loadRuntimeConfigSafe();
  const engine = searchEngineName(cfg);
  const apiKey = esApiKey(cfg);
  const username = esUsername(cfg);
  const url = esUrl(cfg);
  if (engine === "elasticsearch" && !url) {
    throw new Error(
      "全文搜索已选 Elasticsearch，但未配置地址（后台「站点配置 → 搜索」的 ES 地址，或旧 .env ES_URL）",
    );
  }
  return {
    engine,
    candidateLimit: searchCandidateLimit(cfg),
    es: {
      url,
      index: esIndex(cfg),
      analyzer: esAnalyzer(cfg),
      auth: apiKey
        ? { apiKey }
        : username
          ? { username, password: esPassword(cfg) }
          : undefined,
    },
  };
}

let cached: { key: string; engine: SearchEngine } | null = null;

async function engineFor(kind: "postgres" | "elasticsearch"): Promise<SearchEngine> {
  const key = kind;
  if (cached && cached.key === key) return cached.engine;
  const engine =
    kind === "elasticsearch" ? createEsEngine(loadSearchSettings) : createPgEngine();
  await engine.ensure(); // 失败抛错：检索路径由 getFeed 回退子串匹配；同步路径内部容错
  cached = { key, engine };
  return engine;
}

/** 检索 / 同步共用入口：按当前配置返回引擎实例（类型切换自动重建）。 */
export function searchEngine(): Promise<SearchEngine> {
  return loadSearchSettings().then((s) => engineFor(s.engine));
}

/** 检索路径一次拿引擎 + 候选上限（避免 getFeed 二次解析配置）。 */
export async function searchRuntime(): Promise<{ engine: SearchEngine; candidateLimit: number }> {
  const s = await loadSearchSettings();
  return { engine: await engineFor(s.engine), candidateLimit: s.candidateLimit };
}

/**
 * 正文变化后同步索引（在写库事务提交之后调用）。失败只告警，不回滚主流程：
 * 索引属增强能力，与业务写库解耦（查询层交集 + contains 兜底保证可用性）。
 */
export async function syncResourceSearch(resourceId: string): Promise<void> {
  try {
    const doc = await docOfResource(resourceId);
    if (!doc) return;
    await (await searchEngine()).upsert([doc]);
  } catch (e) {
    console.error(`[search] sync failed resource=${resourceId}`, e);
  }
}

/** 批量重建全量索引（脚本 prisma/search-reindex.ts 使用；也兼容单批调试）。 */
export async function reindexAllResources(onBatch?: (done: number) => void): Promise<number> {
  const engine = await searchEngine();
  let cursor: { id: string } | undefined;
  let total = 0;
  const BATCH = 500;
  for (;;) {
    const rows = await prisma.resource.findMany({
      select: { id: true, title: true, summary: true, description: true, updatedAt: true },
      orderBy: { id: "asc" },
      ...(cursor ? { cursor, skip: 1 } : {}),
      take: BATCH,
    });
    if (rows.length === 0) break;
    const docs: SearchDoc[] = rows.map((r) => ({
      resourceId: r.id,
      title: r.title,
      summary: r.summary,
      description: r.description,
      updatedAt: r.updatedAt,
    }));
    await engine.upsert(docs);
    total += rows.length;
    onBatch?.(total);
    if (rows.length < BATCH) break;
    cursor = { id: rows[rows.length - 1].id };
  }
  return total;
}
