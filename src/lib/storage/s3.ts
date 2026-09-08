// S3 兼容驱动：AWS S3 / R2 / MinIO / 任意 S3 协议对象存储（chevereto 若暴露 S3 网关也走这里）。
// 配置：后台「站点配置」（旧 env S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/
// S3_SECRET_ACCESS_KEY/S3_PUBLIC_BASE 回退）。凭据变更自动重建 client（签名比对）。
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { StorageDriver } from "./types";
import {
  getRuntimeConfig,
  s3Bucket as cfgBucket,
  s3Endpoint as cfgEndpoint,
  s3PublicBase as cfgPublicBase,
} from "@/lib/runtime-config";

type S3Cfg = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBase: string;
  aclPrivate: boolean;
};

async function s3Cfg(): Promise<S3Cfg> {
  const c = await getRuntimeConfig();
  return {
    endpoint: cfgEndpoint(c),
    region: c.s3Region || process.env.S3_REGION || "auto",
    bucket: cfgBucket(c),
    accessKeyId: c.s3AccessKeyId || process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: c.s3SecretAccessKey || process.env.S3_SECRET_ACCESS_KEY || "",
    publicBase: cfgPublicBase(c),
    aclPrivate: c.s3AclPrivate,
  };
}

// 模块级单例 client（跨请求复用连接池）；配置签名变了就重建
let client: S3Client | null = null;
let clientSig = "";

function s3(cfg: S3Cfg): S3Client {
  const sig = [cfg.endpoint, cfg.region, cfg.accessKeyId, cfg.secretAccessKey].join("|");
  if (!client || sig !== clientSig) {
    client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint || undefined,
      forcePathStyle: true, // MinIO/R2 需要 path-style
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    clientSig = sig;
  }
  return client;
}

export const s3Driver: StorageDriver = {
  name: "s3",
  async put(key, buf) {
    const cfg = await s3Cfg();
    if (!cfg.bucket) throw new Error("S3 存储未配置：请在后台「站点配置」填写 Bucket");
    await s3(cfg).send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: buf,
        // 公开桶直链可读；私有桶需把公开访问基址指向 CDN
        ACL: cfg.aclPrivate ? undefined : "public-read",
      }),
    );
    if (!cfg.publicBase) throw new Error("S3 存储未配置：缺少公开访问基址（Public Base）");
    return `${cfg.publicBase}/${key}`;
  },
  async get(key) {
    const cfg = await s3Cfg();
    const res = await s3(cfg).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    const body = res.Body as { transformToByteArray(): Promise<Uint8Array> } | undefined;
    if (!body) throw new Error(`S3 对象不存在: ${key}`);
    return Buffer.from(await body.transformToByteArray());
  },
  async size(key) {
    const cfg = await s3Cfg();
    const res = await s3(cfg).send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return res.ContentLength ?? 0;
  },
  async del(key) {
    const cfg = await s3Cfg();
    await s3(cfg)
      .send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
      .catch(() => {});
  },
};
