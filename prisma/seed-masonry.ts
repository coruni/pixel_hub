/* eslint-disable no-console */
// 瀑布流专项测试数据（幂等：slug 前缀 mt_ 重建）。
// 目的：基础/bulk seed 的封面全是 1500×1000 同比例，瀑布流看不出错落。
// 本脚本插一批 IMAGE 资源，封面宽高刻意不同（含被 clampedAspect 限幅的极端比例），
// publishedAt 给到最近几分钟，保证在 /browse 最新流的第一页就能看到。
// 用法：npx tsx prisma/seed-masonry.ts
import { prisma } from "../src/lib/db/prisma";

// 文件复用 public/seed 占位图（卡面 object-cover，会按声明的宽高裁切显示）
const FILES = ["cyber", "forest", "ocean", "pixel", "nebula", "minimal"] as const;

// 不同宽高（clamp [3/4, 4/3] 之外的会渲染成边界比例，正好顺带验证限幅）
const DIMS: Array<[w: number, h: number, label: string]> = [
  [900, 1200, "3:4 竖图"],
  [1000, 1000, "1:1 方图"],
  [1200, 900, "4:3 横图"],
  [800, 1200, "2:3 超竖(限幅3:4)"],
  [1600, 900, "16:9 超横(限幅4:3)"],
  [1250, 1000, "5:4 横图"],
  [1080, 1350, "4:5 竖图(限幅3:4)"],
  [1400, 1000, "7:5 横图"],
  [1024, 1024, "1:1 方图"],
  [960, 1280, "3:4 竖图"],
  [1150, 950, "横图微差"],
  [980, 1060, "接近方图"],
];

async function main() {
  console.log("🧱 写入瀑布流测试数据…");
  await prisma.$transaction(async (tx) => {
    // 幂等：先删旧批（Media 经 resourceId 级联，无外键残留）
    await tx.resource.deleteMany({ where: { slug: { startsWith: "mt_" } } });

    const author =
      (await tx.user.findFirst({ where: { username: "creator" } })) ??
      (await tx.user.findFirst({ where: { role: "ADMIN" } }));
    if (!author) throw new Error("库里没有用户，请先跑 npm run db:seed");

    const cat = await tx.category.findFirst({ where: { slug: "illustration" } });

    const n = DIMS.length * 2; // 两轮，让每个比例出现两次，列分配更好看
    for (let i = 0; i < n; i++) {
      const [w, h, label] = DIMS[i % DIMS.length];
      const file = FILES[i % FILES.length];
      const slug = `mt_${String(i + 1).padStart(2, "0")}`;
      const res = await tx.resource.create({
        data: {
          slug,
          title: `瀑布测试 ${String(i + 1).padStart(2, "0")}（${label} ${w}×${h}）`,
          summary: `封面 ${w}×${h}，${label}。瀑布流列高估算用。`,
          description: `测试卡片：声明封面尺寸 **${w}×${h}**（${label}）。\n\n- 限幅内的比例应原样呈现\n- 限幅外（2:3、16:9、4:5）应被 clamp 到 3:4 或 4:3`,
          type: "IMAGE",
          status: "PUBLISHED",
          authorId: author.id,
          categoryId: cat?.id ?? null,
          isDownloadable: false,
          meta: JSON.stringify({ isAiGenerated: false, original: true, license: "" }),
          publishedAt: new Date(Date.now() - (n - i) * 60_000), // 逆序分钟，排进第一页顶部
        },
      });
      const media = await tx.media.create({
        data: {
          resourceId: res.id,
          kind: "COVER",
          uploaderId: author.id,
          storageKey: `seed/${file}.svg`,
          width: w,
          height: h,
          size: 800,
          mime: "image/svg+xml",
          sort: 0,
          status: "READY",
          fileName: `${file}.svg`,
        },
      });
      await tx.resource.update({ where: { id: res.id }, data: { coverMediaId: media.id } });
    }
  });
  const total = await prisma.resource.count({ where: { slug: { startsWith: "mt_" } } });
  console.log(`✅ 完成：${total} 条（/browse 最新流顶部，slug 前缀 mt_）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
