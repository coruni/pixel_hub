// 一次性回填：CosHub 导入期分级记录在 meta.sourceNote 文本里（「原站 CosHub 评级：nsfw/sfw」），
// 现迁移进独立 Resource.nsfw 列，供 D9 NSFW 隔离以可查询布尔过滤。
//
// 用法：npx tsx prisma/backfill-nsfw.ts   （连当前 DATABASE_URL 指向的库）
// 幂等：只把 meta 含 nsfw 标记且尚未置位的行置 true；SFW 与手动标记不受影响。
import { prisma } from "../src/lib/db/prisma";

async function main() {
  const [flagged, already] = await Promise.all([
    prisma.$queryRaw<{ c: number }[]>`SELECT count(*)::int AS c FROM "Resource" WHERE "meta" ILIKE '%nsfw%'`,
    prisma.$queryRaw<{ c: number }[]>`SELECT count(*)::int AS c FROM "Resource" WHERE "nsfw" = true`,
  ]);
  const n = flagged[0]?.c ?? 0;
  const have = already[0]?.c ?? 0;
  console.log(`meta 含 nsfw 标记：${n} 条；库中 nsfw=true：${have} 条`);
  if (n > have) {
    const r = await prisma.$executeRawUnsafe(
      `UPDATE "Resource" SET "nsfw" = true WHERE "meta" ILIKE '%nsfw%' AND "nsfw" = false`,
    );
    console.log(`已回填 ${r} 条`);
  } else {
    console.log("无需回填");
  }
  const after = await prisma.$queryRaw<{ c: number }[]>`SELECT count(*)::int AS c FROM "Resource" WHERE "nsfw" = true`;
  console.log("回填后 nsfw=true 共", after[0]?.c ?? 0, "条");
}

main()
  .catch((e) => {
    console.error("❌ 回填失败", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
