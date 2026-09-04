// S3 兼容驱动：AWS S3 / R2 / MinIO / 任意 S3 协议对象存储（chevereto 若暴露 S3 网关也走这里）。
// env: S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_PUBLIC_BASE（公开访问基址，缺省用 endpoint/bucket 拼）
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { StorageDriver } from "./types";

const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET ?? "";
const publicBase = (process.env.S3_PUBLIC_BASE ?? `${endpoint}/${bucket}`).replace(/\/$/, "");

let client: S3Client | null = null;
function s3(): S3Client {
  if (!bucket) throw new Error("S3 存储未配置：缺少 S3_BUCKET");
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION ?? "auto",
      endpoint,
      forcePathStyle: true, // MinIO/R2 需要 path-style
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return client;
}

export const s3Driver: StorageDriver = {
  name: "s3",
  async put(key, buf) {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        // 公开桶直链可读；私有桶需把 S3_PUBLIC_BASE 指向 CDN
        ACL: process.env.S3_ACL === "private" ? undefined : "public-read",
      }),
    );
    return `${publicBase}/${key}`;
  },
  async get(key) {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = res.Body as { transformToByteArray(): Promise<Uint8Array> } | undefined;
    if (!body) throw new Error(`S3 对象不存在: ${key}`);
    return Buffer.from(await body.transformToByteArray());
  },
  async size(key) {
    const res = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return res.ContentLength ?? 0;
  },
  async del(key) {
    await s3()
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      .catch(() => {});
  },
};
