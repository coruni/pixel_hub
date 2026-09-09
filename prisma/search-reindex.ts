// 存量资源全文索引重建（幂等可重跑）。
// 用法：npm run search:reindex
// 说明：
//   - 引擎按后台「站点配置 → 搜索」选择（未设置默认 postgres，旧 .env SEARCH_ENGINE/ES_* 回退），
//     切换引擎或改 ES 集群后重跑本脚本即重建目标索引/表。
//   - 默认 PostgreSQL(pg_trgm) 引擎：首次运行自动建扩展/镜像表/GIN 索引（需目标库允许 pg_trgm，
//     Supabase 默认放行）。
//   - 业务表已有行不在索引里只会让搜索少命中，不会出错；发布/改稿会自动同步增量（见 syncResourceSearch）。
import { loadSearchSettings, reindexAllResources } from "../src/lib/search";

async function main(): Promise<void> {
  const settings = await loadSearchSettings();
  const t0 = Date.now();
  console.log(`[search:reindex] engine=${settings.engine} 开始重建…`);
  let last = 0;
  const total = await reindexAllResources((done) => {
    if (done - last >= 1000 || done === 0) {
      last = done;
      console.log(`[search:reindex] 已写入 ${done} 条`);
    }
  });
  console.log(`[search:reindex] 完成：${total} 条，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error("[search:reindex] 失败：", e);
  console.error("  - PG 引擎请确认目标库可执行 CREATE EXTENSION pg_trgm（Supabase：可在 SQL Editor 手动执行后再跑）");
  process.exit(1);
});
