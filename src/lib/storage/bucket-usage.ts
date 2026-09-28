// 多桶容量用量：给「上传前预检」提供每个桶的已用字节数（见 s3.ts 的 put）。
//
// 为什么不用 ListObjectsV2 实时统计：那是 Class A 请求（按千次计费），大桶还要翻几十上百页，
// 塞进上传路径等于每次上传加几百毫秒和一笔账单。为什么也不用增量记账表：外部删对象
// （CDN 清缓存、手工删 S3 对象）后计数只增不减，漂移没有自愈路径。
//
// 这里走「按已入库的 Media.size 反解桶求和」：零额外 API 请求、零新表、每次全量重算所以自愈。
// 代价是漏掉非 Media 来源的上传（音视频附件等），而阈值本身是软约束（见下），留够余量即可。
//
// 性能：只取 storageKey + size 两列，配 60s 进程内快照 + 并发去重；并且**只有真有桶配了
// 容量上限时才会被调用**（没配 = 一次库都不查，行为与升级前完全一致）。
import { prisma } from "@/lib/db/prisma";
import { getRuntimeConfig, s3BucketSpecs } from "@/lib/runtime-config";
import { resolveS3Target } from "./s3-key";

/** 快照有效期：容量是软约束，一分钟的滞后远小于用户该留的安全余量 */
const TTL_MS = 60_000;

let snapshot: { at: number; usage: Map<string, number> } | null = null;
/** 并发去重：TTL 到期时同时到达的上传共用一个查询，不然会一起打满库 */
let inflight: Promise<Map<string, number>> | null = null;

async function compute(): Promise<Map<string, number>> {
  const usage = new Map<string, number>();
  // 反解需要完整桶清单，所以先取配置（这一步本身有请求级缓存）
  const specs = s3BucketSpecs(await getRuntimeConfig());
  if (specs.length === 0) return usage;
  const rows = await prisma.media.findMany({
    // 只看完整 URL：S3 驱动的 put 落库的必然是 URL（`http(s)://…`），而云盘（`/od/…`）
    // 与本地（`/uploads/…`）的文件根本不在 S3 桶里 —— 收进来会白占主桶额度。
    where: { size: { gt: 0 }, storageKey: { startsWith: "http" } },
    select: { storageKey: true, size: true },
  });
  for (const r of rows) {
    const target = resolveS3Target(r.storageKey, specs);
    if (!target) continue;
    usage.set(target.id, (usage.get(target.id) ?? 0) + (r.size ?? 0));
  }
  return usage;
}

/** 每个桶的已用字节数（key = S3BucketSpec.id）。失败时返回空 Map：宁可放行也不能因为统计不上就拒绝上传 */
export async function s3UsageSnapshot(): Promise<Map<string, number>> {
  if (snapshot && Date.now() - snapshot.at < TTL_MS) return snapshot.usage;
  if (inflight) return inflight;
  inflight = compute()
    .then((usage) => {
      snapshot = { at: Date.now(), usage };
      return usage;
    })
    .catch((e) => {
      console.warn("[s3] 统计存储桶用量失败（本次按未超限处理）：", e);
      return new Map<string, number>();
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * 上传成功后乐观累加，省掉「紧接着下一次上传又要扫库」。
 * 只在已有快照时生效（没有快照说明还没做过统计，下次调用自然会算全量）。
 */
export function bumpUsage(bucketId: string, bytes: number): void {
  if (!snapshot || bytes <= 0) return;
  snapshot.usage.set(bucketId, (snapshot.usage.get(bucketId) ?? 0) + bytes);
}
