// S3 兼容驱动：AWS S3 / R2 / MinIO / 任意 S3 协议对象存储（chevereto 若暴露 S3 网关也走这里）。
// 配置：后台「站点配置」（旧 env S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/
// S3_SECRET_ACCESS_KEY/S3_PUBLIC_BASE 回退）。凭据变更自动重建 client（签名比对）。
//
// 多桶：主桶之外可在后台追加备用桶（默认继承主配置的 Endpoint/凭据），上传按
// 「主桶 → 备用桶 1…N」取第一个未标记「已满」的桶（见 runtime-config 的 s3UploadBuckets）。
// 落库的仍是**完整 URL**，桶信息自带在 URL 里 —— 所以换桶/加桶不影响任何存量数据；
// 反过来 get/size/del 必须先从 key 反解出「哪个桶 + 桶内 key」，见 resolveTarget。
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { StorageDriver } from "./types";
import { resolveContentType } from "./mime";
import { resolveS3Target } from "./s3-key";
import {
  getRuntimeConfig,
  s3BucketSpecs,
  s3UploadBuckets,
  type S3BucketSpec,
} from "@/lib/runtime-config";

/** 同一份配置复用同一个 client（连接池跨请求保留）；任一字段变了就换新的 */
const clients = new Map<string, S3Client>();
/** 上限：配置改一次就多一个签名，不做回收会随进程寿命无界增长（超出丢最旧的，重建只是丢连接池） */
const MAX_CLIENTS = 32;

function s3(cfg: S3BucketSpec): S3Client {
  // pathStyle 也进签名：同一个端点/凭据下两种寻址方式发出的请求 URL 不同，不能共用实例
  const sig = [cfg.endpoint, cfg.region, cfg.accessKeyId, cfg.secretAccessKey, cfg.pathStyle].join("|");
  let client = clients.get(sig);
  if (!client) {
    client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint || undefined,
      // path-style（endpoint/bucket/key）是 MinIO/R2 与多数 S3 兼容网关的要求；
      // 少数只认 virtual-host style（bucket.endpoint/key）的服务商可在后台按桶切换。
      forcePathStyle: cfg.pathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    clients.set(sig, client);
    if (clients.size > MAX_CLIENTS) {
      const oldest = clients.keys().next().value;
      if (oldest !== undefined) clients.delete(oldest);
    }
  }
  return client;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Target = { cfg: S3BucketSpec; objectKey: string };

/** 把落库值（相对 key 或完整 URL）反解成「桶 + 桶内 key」；反解规则见 ./s3-key */
async function resolveTarget(key: string): Promise<Target | null> {
  const specs = s3BucketSpecs(await getRuntimeConfig());
  const t = resolveS3Target(key, specs);
  if (!t) return null;
  const cfg = specs.find((s) => s.id === t.id) ?? specs[0];
  return { cfg, objectKey: t.objectKey };
}

export const s3Driver: StorageDriver = {
  name: "s3",
  async put(key, buf, contentType) {
    // 候选链已在配置层算好（跳过「已满」的桶）；这里逐个尝试，某个桶写失败就往下走。
    const specs = s3UploadBuckets(await getRuntimeConfig());
    if (specs.length === 0) throw new Error("S3 存储未配置：请在后台「站点配置」填写 Bucket");

    const failures: string[] = [];
    for (const cfg of specs) {
      // 缺公开基址就换下一个桶：先落对象再抛错会留下一个没人引用、又删不掉的孤儿
      if (!cfg.publicBase) {
        failures.push(`「${cfg.label}」缺少公开访问基址（Public Base）`);
        continue;
      }
      try {
        await s3(cfg).send(
          new PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: buf,
            // 必须显式带 ContentType：S3 不会按扩展名猜类型，缺省落成 binary/octet-stream，
            // 直链访问图片/PDF 会变成「下载」而不是预览。调用方没给（或给的类型不可信）时
            // 按 key 扩展名兜底 —— 见 ./mime。
            ContentType: resolveContentType(contentType, key),
            // 公开桶直链可读；私有桶需把公开访问基址指向 CDN
            ACL: cfg.aclPrivate ? undefined : "public-read",
          }),
        );
        // 落库即完整 URL：桶信息自带，读/删时无需再查配置（换桶也不影响存量）
        return `${cfg.publicBase}/${key}`;
      } catch (e) {
        // 桶满 / 配额 / 网络等一律换下一个桶；全部失败时把每个桶的原因一起抛出，便于定位
        failures.push(`「${cfg.label}」${errorText(e)}`);
        console.warn(`[s3] 写入桶「${cfg.label}」失败，尝试下一个桶：`, e);
      }
    }
    throw new Error(`S3 上传失败（已尝试 ${specs.length} 个存储桶）：${failures.join("；")}`);
  },
  async get(key) {
    const t = await resolveTarget(key);
    if (!t) throw new Error("S3 存储未配置：请在后台「站点配置」填写 Bucket");
    const res = await s3(t.cfg).send(
      new GetObjectCommand({ Bucket: t.cfg.bucket, Key: t.objectKey }),
    );
    const body = res.Body as { transformToByteArray(): Promise<Uint8Array> } | undefined;
    if (!body) throw new Error(`S3 对象不存在: ${key}`);
    return Buffer.from(await body.transformToByteArray());
  },
  async size(key) {
    const t = await resolveTarget(key);
    if (!t) return 0;
    const res = await s3(t.cfg).send(
      new HeadObjectCommand({ Bucket: t.cfg.bucket, Key: t.objectKey }),
    );
    return res.ContentLength ?? 0;
  },
  async del(key) {
    if (!key) return;
    const t = await resolveTarget(key);
    if (!t) return;
    await s3(t.cfg)
      .send(new DeleteObjectCommand({ Bucket: t.cfg.bucket, Key: t.objectKey }))
      .catch((e) => console.warn(`[s3] 删除对象失败（忽略）：${key}`, e));
  },
};
