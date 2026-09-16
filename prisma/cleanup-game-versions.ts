// 一次性清理：GAME 不再有版本概念，删掉属于 GAME 的 ResourceVersion 记录。
//
// 背景：GAME 早期把下载源写进 ResourceVersion，详情页既渲染「游戏下载」又渲染「版本历史」，
// 同一批 URL 出现两处。现在 GAME 的下载源清单只存 meta.downloads，这张表的 GAME 记录应当清掉。
//
// 用法：
//   npx tsx prisma/cleanup-game-versions.ts --dry   # 只预览，不写库
//   npx tsx prisma/cleanup-game-versions.ts         # 实际清理
//
// 判定依据（实测存量）：本库 GAME 的下载源清单本来就不在 meta.downloads 里
// （历史上 49 条 GAME 只有 externalUrl，仅 1 条有版本记录）。所以清理前先把「有 url 的版本记录」
// 回填进 meta.downloads，避免丢掉那唯一一条真实清单；**不用 externalUrl 反造清单**——
// 详情页与编辑页都直接读 externalUrl，凭空写一条只会把「没有清单」变成「有一条假清单」。
import { prisma } from "../src/lib/db/prisma";

const DRY = process.argv.includes("--dry");

async function main() {
  const games = await prisma.resource.findMany({
    where: { type: "GAME" },
    select: {
      id: true,
      slug: true,
      meta: true,
      versions: { select: { id: true, url: true }, orderBy: { createdAt: "asc" } },
    },
  });

  console.log(`GAME 资源：${games.length} 条${DRY ? "（dry-run，不写库）" : ""}`);

  let backfilled = 0;
  let cleaned = 0;
  let pending = 0;

  for (const g of games) {
    const withUrl = g.versions.filter((v) => (v.url ?? "").trim());
    if (g.versions.length === 0) continue;
    pending += g.versions.length;

    // 先在 meta 里保住真实清单（幂等：meta.downloads 已有内容就跳过，不覆盖）
    if (withUrl.length > 0) {
      let meta: Record<string, unknown> = {};
      let ok = true;
      try {
        const parsed = JSON.parse(g.meta ?? "{}");
        if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
      } catch {
        ok = false;
        console.log(`  跳过回填 ${g.slug}：meta 不是合法 JSON`);
      }
      const existing = Array.isArray(meta.downloads) ? meta.downloads : [];
      const hasUrls = existing.some(
        (d) => d && typeof d === "object" && String((d as { url?: unknown }).url ?? "").trim(),
      );
      if (ok && !hasUrls) {
        const seen = new Set<string>();
        const list = withUrl
          .map((v) => String(v.url).trim())
          .filter((u) => (seen.has(u) ? false : (seen.add(u), true)))
          .map((url) => ({ name: url, kind: "link" as const, url }));
        meta.downloads = list;
        // version 是已废弃字段，顺手摘掉
        delete meta.version;
        if (!DRY) {
          await prisma.resource.update({ where: { id: g.id }, data: { meta: JSON.stringify(meta) } });
        }
        console.log(`  回填 ${g.slug}：${list.length} 条下载源 → meta.downloads`);
        backfilled += 1;
      }
    }

    if (!DRY) {
      const r = await prisma.resourceVersion.deleteMany({
        where: { id: { in: g.versions.map((v) => v.id) } },
      });
      cleaned += r.count;
    }
  }

  console.log(
    `\n${DRY ? "[dry-run] " : ""}回填清单 ${backfilled} 条 / 待删版本记录 ${pending} 条${DRY ? "" : ` / 实删 ${cleaned} 条`}`,
  );
}

main()
  .catch((e) => {
    console.error("❌ 清理失败", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
