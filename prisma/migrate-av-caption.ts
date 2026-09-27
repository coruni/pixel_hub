// 一次性数据迁移：把存量音视频 meta 规整成当前 avMetaSchema 的形状。
//
// 旧形状：{ mode, source, url, artist, duration, resolution,
//           captions: [{ label, format, text }], tracks: [{ title, url, duration }] }
// 新形状：{ mode, title, url, caption?: { format, text },
//           tracks: [{ title, url, caption? }] }
//
// 脚本做的六件事：
//   ① 删掉 source（它只是「作者贴地址还是点上传」的操作差异，落库结果都是同一个 URL）
//   ② captions 数组的**第一条**提升为主来源（第一 P）的 caption
//   ③ 补 title（空串）、把 mode 按新口径钉死（MUSIC 恒 direct）
//   ④ 删掉时长 / 艺术家 / 分辨率三个资源级字段（2026-09-27 整体取消：
//      它们是「从一个文件里自动读出来」的元信息，作者不该为自动读到什么负责，详情页也不再展示）
//   ⑤ 规整 tracks 的键：只留 title / url / caption（同理去掉分P 自己的 duration）
//   ⑥ 注释里提到的旧键之外，**其它未知键（历史演示数据里的 provider / album / license / note）
//      原样保留** —— 读取层本来就会 strip 掉，这里没必要顺手删库里的东西。
//
// 为什么可以先不迁移：parseMeta 的读取层一直兼容旧结构（captions[0] → caption，未知键 strip），
// 迁移只是把库里的形状规整干净。**字幕部分的顺序仍是「新代码先上线，再跑这个脚本」** ——
// 旧镜像读到新数据会认不出 captions，字幕会整批消失（见 AGENTS.md「破坏性迁移拆两批」的教训）。
//
// **会丢数据的地方**：旧结构一个资源可以挂多条字幕（多语言 / 多版本），新结构一项只带一份，
// 除第一条外没有归属的曲目。脚本不会静默丢弃 —— 逐条打出「资源 slug / 被丢掉的条数与名称」，
// 由运营决定是否联系作者把剩下的重新挂到对应曲目上。
//
// 用法：
//   npx tsx prisma/migrate-av-caption.ts           # dry-run：只统计并打印将要改什么
//   npx tsx prisma/migrate-av-caption.ts --apply   # 实际写库（幂等：已迁移过的行不再改动）
import { prisma } from "../src/lib/db/prisma";
import { CAPTION_FORMATS } from "../src/lib/captions";

const APPLY = process.argv.includes("--apply");

type CaptionLike = { format: unknown; text: unknown; label?: unknown };

/** 旧字幕项 → 新 caption；文本为空或形状不对返回 null（该项就当没挂字幕） */
function toCaption(c: unknown) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const o = c as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text : "";
  if (!text.trim()) return null;
  const format = (CAPTION_FORMATS as readonly string[]).includes(String(o.format))
    ? (o.format as string)
    : "srt";
  return { format, text };
}

/** 迁移一行的 meta；不需要改动时返回 null */
function migrate(type: string, raw: string | null) {
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    // 坏 JSON：不猜、不改，交给人工看（写入侧本来也不会产出坏 JSON）
    return null;
  }

  const oldCaps = Array.isArray(obj.captions) ? (obj.captions as CaptionLike[]) : [];
  const hasTitle = typeof obj.title === "string";
  const wantMode = type === "MUSIC" ? "direct" : obj.mode === "embed" ? "embed" : "direct";
  const cleanTracks = (Array.isArray(obj.tracks) ? obj.tracks : [])
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      title: typeof t.title === "string" ? t.title : "",
      url: typeof t.url === "string" ? t.url : "",
      ...(toCaption(t.caption) ? { caption: toCaption(t.caption)! } : {}),
    }));
  const tracksSame =
    JSON.stringify(cleanTracks) === JSON.stringify(Array.isArray(obj.tracks) ? obj.tracks : []);

  const needs =
    "captions" in obj ||
    "source" in obj ||
    // 已取消的三个资源级字段：时长 / 艺术家 / 分辨率（tracks 里的 duration 由 tracksSame 覆盖）
    "duration" in obj ||
    "artist" in obj ||
    "resolution" in obj ||
    !hasTitle ||
    obj.mode !== wantMode ||
    !Array.isArray(obj.tracks) ||
    !tracksSame;
  if (!needs) return null;

  const next: Record<string, unknown> = { ...obj };
  delete next.captions;
  delete next.source;
  delete next.duration;
  delete next.artist;
  delete next.resolution;
  next.mode = wantMode;
  next.title = hasTitle ? obj.title : "";
  next.tracks = cleanTracks;
  if (!("caption" in next)) {
    const first = toCaption(oldCaps[0]);
    if (first) next.caption = first;
  }

  // 除第一条以外没有归属的字幕：只报告，不静默吞掉
  const dropped = oldCaps
    .slice(1)
    .map((c, i) => ({ no: i + 2, label: String(c?.label ?? "").trim(), format: String(c?.format ?? "") }));

  return { next, dropped, oldCount: oldCaps.length };
}

async function main() {
  const rows = await prisma.resource.findMany({
    where: { type: { in: ["MUSIC", "VIDEO"] } },
    select: { id: true, slug: true, type: true, meta: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`音视频资源共 ${rows.length} 条；模式 = ${APPLY ? "写库" : "dry-run（加 --apply 才写）"}\n`);

  let changed = 0;
  let droppedTotal = 0;
  const dirty: string[] = [];

  for (const r of rows) {
    const plan = migrate(r.type, r.meta);
    if (!plan) {
      // 坏 JSON 是唯一「读得到却迁不动」的情况，单独点名
      if (r.meta && !/^\s*\{/.test(r.meta)) dirty.push(r.slug);
      continue;
    }
    changed += 1;
    droppedTotal += plan.dropped.length;
    console.log(
      `${APPLY ? "改" : "将改"} ${r.type.padEnd(5)} ${r.slug}` +
        (plan.oldCount > 0 ? `（旧字幕 ${plan.oldCount} 条 → 保留 1 条）` : ""),
    );
    for (const d of plan.dropped)
      console.log(`      ⚠ 丢弃第 ${d.no} 条${d.label ? `「${d.label}」` : ""}（${d.format}）—— 需人工确认是否重挂`);
    if (APPLY)
      await prisma.resource.update({ where: { id: r.id }, data: { meta: JSON.stringify(plan.next) } });
  }

  console.log(`\n${APPLY ? "已迁移" : "待迁移"} ${changed} 条；被丢弃的字幕 ${droppedTotal} 条`);
  if (dirty.length > 0) console.log(`⚠ meta 不是合法 JSON、未处理：${dirty.join(", ")}`);
  if (!APPLY && changed > 0) console.log("\n确认无误后重跑：npx tsx prisma/migrate-av-caption.ts --apply");
}

main()
  .catch((e) => {
    console.error("❌ 迁移失败", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
