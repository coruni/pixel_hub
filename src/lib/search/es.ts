// Elasticsearch 全文检索实现（可选后端）：直接使用 Node 全局 fetch 调 ES HTTP API，零新增依赖。
//
// 连接参数来自后台运行配置（每次请求按最新值解析）：地址/索引/分析器/认证，见 search/index.ts
// 的 loadSearchSettings（后台「站点配置 → 搜索」优先，旧 .env ES_* 回退）。
//
// 注意：
//   - 索引映射在 ensure()（创建引擎时调用）幂等创建（PUT /{index}）；
//   - 中文检索质量取决于分析器：生产中文站请部署 ik 等分词插件并设分析器 ik_max_word，
//     未配置时使用 ES 默认 standard 分析器（英文正常；中文只有整串连续命中才有效）；
//   - 本实现与 PG 后端遵循同一接口契约：只做文本匹配与相关度排序，业务过滤由查询层完成。
import type { SearchDoc, SearchEngine, SearchSettings } from "./index";

type EsConn = {
  url: string;
  index: string;
  analyzer?: string;
  headers: Record<string, string>;
};

export function createEsEngine(getSettings: () => Promise<SearchSettings>): SearchEngine {
  let ensured = false;

  async function conn(): Promise<EsConn> {
    const s = await getSettings();
    const headers: Record<string, string> = {};
    const auth = s.es.auth;
    if (auth) {
      if ("apiKey" in auth && auth.apiKey) headers.Authorization = `ApiKey ${auth.apiKey}`;
      else if ("username" in auth && auth.username) {
        headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
      }
    }
    return {
      url: s.es.url.replace(/\/+$/, ""),
      index: s.es.index,
      analyzer: s.es.analyzer || undefined,
      headers,
    };
  }

  return {
    kind: "elasticsearch",

    async ensure() {
      if (ensured) return;
      const c = await conn();
      // 幂等建索引：存在即跳过（GET 404 才 PUT），避免并发/重复 PUT 告警
      const exists = await request(c, { method: "GET", path: `/${c.index}` }).then(
        () => true,
        (e: unknown) => {
          const status = (e as { status?: number }).status;
          if (status === 404) return false;
          throw e;
        },
      );
      if (!exists) {
        const textField = (f: string) =>
          c.analyzer
            ? { [f]: { type: "text", analyzer: c.analyzer, search_analyzer: c.analyzer } }
            : { [f]: { type: "text" } };
        await request(c, {
          method: "PUT",
          path: `/${c.index}`,
          body: {
            mappings: {
              properties: {
                resourceId: { type: "keyword" },
                ...textField("title"),
                ...textField("summary"),
                ...textField("description"),
                updatedAt: { type: "date" },
              },
            },
          },
        });
      }
      ensured = true;
    },

    async search(q: string, { limit }: { limit: number }) {
      const c = await conn();
      const res = await request(c, {
        method: "POST",
        path: `/${c.index}/_search`,
        body: {
          size: limit,
          _source: false,
          query: {
            multi_match: {
              query: q,
              fields: ["title^4", "summary^2", "description"],
              type: "best_fields",
            },
          },
        },
      });
      const hits = (res as { hits?: { hits?: { _id?: string }[] } }).hits?.hits ?? [];
      const ids = hits.map((h) => h._id).filter((x): x is string => !!x);
      return { ids, truncated: hits.length >= limit };
    },

    async upsert(docs: SearchDoc[]) {
      if (docs.length === 0) return;
      const c = await conn();
      const lines: string[] = [];
      for (const d of docs) {
        lines.push(JSON.stringify({ index: { _index: c.index, _id: d.resourceId } }));
        lines.push(
          JSON.stringify({
            title: d.title,
            summary: d.summary ?? "",
            description: d.description,
            updatedAt: d.updatedAt.toISOString(),
          }),
        );
      }
      await bulk(c, lines);
    },

    async remove(resourceIds: string[]) {
      if (resourceIds.length === 0) return;
      const c = await conn();
      const lines = resourceIds.map((id) =>
        JSON.stringify({ delete: { _index: c.index, _id: id } }),
      );
      await bulk(c, lines);
    },
  };

  async function bulk(c: EsConn, actionLines: string[]): Promise<void> {
    const res = await request(c, {
      method: "POST",
      path: "/_bulk",
      rawBody: actionLines.join("\n") + "\n",
      headers: { "Content-Type": "application/x-ndjson" },
    });
    const failed = (res as { items?: { [k: string]: { error?: unknown } }[] }).items?.filter(
      (it) => {
        const op = it[Object.keys(it)[0]];
        return op && "error" in op && op.error;
      },
    );
    if (failed && failed.length > 0) throw new Error(`ES bulk 部分失败: ${failed.length} 项`);
  }

  async function request(
    c: EsConn,
    opts: { method: string; path: string; body?: unknown; rawBody?: string; headers?: Record<string, string> },
  ): Promise<unknown> {
    const res = await fetch(`${c.url}${opts.path}`, {
      method: opts.method,
      headers: {
        ...c.headers,
        "Content-Type": "application/json",
        ...opts.headers,
      },
      body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        `ES ${opts.method} ${opts.path} -> ${res.status}: ${text.slice(0, 300)}`,
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return undefined;
    const ct = res.headers.get("content-type") ?? "";
    return ct.includes("application/json") ? res.json() : res.text();
  }
}
