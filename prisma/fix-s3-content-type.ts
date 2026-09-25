// 存量对象 Content-Type 补正 —— 修「S3 直链访问图片变成下载」的历史数据。
//
// 背景：修复前 s3 驱动写对象时**没带 ContentType**，S3 不会按扩展名猜类型，
// 对象一律落成 `binary/octet-stream`；浏览器直链打开就是下载而不是预览。
// 代码侧已修（见 src/lib/storage/s3.ts），但**已经上传的对象不会自动变好**，用本脚本补。
//
// 用法：
//   npx tsx prisma/fix-s3-content-type.ts            # 预演：只列出需要补正的 key 与目标类型
//   npx tsx prisma/fix-s3-content-type.ts --apply    # 实际补正
//
// 原理：CopyObject 原地复制自身 + MetadataDirective=REPLACE，**只重写元数据**，
// 不重新上传字节（无额外流量、不动 key、不动对象内容）。幂等，可反复重跑。
//
// 两个必须注意的点：
//   ① CopyObject 不继承源对象 ACL，默认落成 private —— 这里按驱动 put 的口径补回
//      public-read（后台开了「ACL 私有」则不带 ACL 头）；桶若禁止 ACL（BucketOwnerEnforced）
//      会自动去掉 ACL 头重试一次。
//   ② 只处理**本站存储的相对 key**；chevereto 远端 URL、OneDrive 的 /od/ 引用一律跳过
//      （它们的类型由远端服务自己决定，这里改不了）。
//
// 前置：DATABASE_URL 指向目标库，且后台「站点配置」里的 S3 配置就是线上那套（走 .env 亦可）。
import { CopyObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "../src/lib/db/prisma";
import { getRuntimeConfig, s3Bucket, s3Endpoint } from "../src/lib/runtime-config";
import { resolveContentType } from "../src/lib/storage/mime";
import { isUrl } from "../src/lib/storage/types";

const APPLY = process.argv.includes("--apply");
/** 并发上限：补正是轻量元数据操作，但别把 S3 打出限流 */
const CONCURRENCY = 6;

type Target = {
  key: string;
  /** 库里的 mime（Media.mime）；用户头像/横幅没有该列，交给扩展名推断 */
  declared?: string | null;
  from: string;
};

/** 本站相对 key 才算数：跳过 http(s) 远端 URL、以 / 开头的站内 URL、OneDrive 引用 */
function isOwnKey(key: string | null | undefined): key is string {
  if (!key) return false;
  return !isUrl(key) && !key.startsWith("/");
}

async function collectTargets(): Promise<Map<string, Target>> {
  const out = new Map<string, Target>();
  const add = (key: string | null | undefined, declared: string | null | undefined, from: string) => {
    if (!isOwnKey(key) || out.has(key)) return;
    out.set(key, { key, declared, from });
  };

  const medias = await prisma.media.findMany({
    select: { id: true, kind: true, storageKey: true, thumbKey: true, bigKey: true, mime: true },
  });
  for (const m of medias) {
    add(m.storageKey, m.mime, `Media(${m.kind})`);
    add(m.thumbKey, null, `Media(${m.kind}).thumb`);
    add(m.bigKey, null, `Media(${m.kind}).big`);
  }

  const users = await prisma.user.findMany({
    select: { id: true, avatarKey: true, heroImageKey: true, profileBgPcKey: true },
  });
  for (const u of users) {
    add(u.avatarKey, null, "User.avatar");
    add(u.heroImageKey, null, "User.hero");
    add(u.profileBgPcKey, null, "User.profileBg");
  }

  return out;
}

async function main() {
  const cfg = await getRuntimeConfig();
  if (cfg.storageDriver !== "s3") {
    console.error(
      `当前存储驱动是「${cfg.storageDriver}」，不是 s3 —— 本脚本只补 S3 对象，已退出。`,
    );
    process.exit(1);
  }
  const bucket = s3Bucket(cfg);
  if (!bucket) {
    console.error("S3 未配置 Bucket，请先在后台「站点配置」填写。");
    process.exit(1);
  }

  const client = new S3Client({
    region: cfg.s3Region || process.env.S3_REGION || "auto",
    endpoint: s3Endpoint(cfg) || undefined,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.s3AccessKeyId || process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: cfg.s3SecretAccessKey || process.env.S3_SECRET_ACCESS_KEY || "",
    },
  });
  const aclPrivate = cfg.s3AclPrivate;
  // 桶禁止 ACL（Object Ownership = BucketOwnerEnforced）时置 false，后续不再带 ACL 头
  let useAcl = !aclPrivate;

  const targets = [...(await collectTargets()).values()];
  console.log(`扫描到 ${targets.length} 个本站存储 key（bucket=${bucket}）。`);
  if (!APPLY) console.log("预演模式：只读，不会写入。加 --apply 才会实际补正。\n");

  const stats = { ok: 0, fixed: 0, missing: 0, failed: 0 };

  async function handle(t: Target) {
    const want = resolveContentType(t.declared, t.key);
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: t.key }));
      const now = head.ContentType ?? "";
      if (now === want) {
        stats.ok++;
        return;
      }
      if (!APPLY) {
        console.log(`[待补] ${t.key}  ${now || "(无)"} → ${want}   ← ${t.from}`);
        stats.fixed++;
        return;
      }
      const copy = (withAcl: boolean) =>
        client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: t.key,
            CopySource: encodeURIComponent(`${bucket}/${t.key}`),
            MetadataDirective: "REPLACE",
            ContentType: want,
            ACL: withAcl ? "public-read" : undefined,
          }),
        );
      try {
        await copy(useAcl);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 桶禁止 ACL 时去掉 ACL 头重试一次，并把该结论应用到后续对象
        if (useAcl && /ACL|AccessControlListNotSupported/i.test(msg)) {
          console.warn("桶不允许 ACL，后续补正不再带 ACL 头。");
          useAcl = false;
          await copy(false);
        } else {
          throw e;
        }
      }
      console.log(`[已补] ${t.key}  ${now || "(无)"} → ${want}`);
      stats.fixed++;
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err.name === "NotFound" || err.name === "NoSuchKey") {
        console.warn(`[缺失] ${t.key} 对象不存在，跳过（${t.from}）`);
        stats.missing++;
        return;
      }
      console.error(`[失败] ${t.key}: ${err.message ?? e}`);
      stats.failed++;
    }
  }

  // 简易并发池：按 CONCURRENCY 个 worker 抢同一个队列
  const queue = [...targets];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) await handle(t);
    }),
  );

  console.log(
    `\n完成：类型已正确 ${stats.ok}，${APPLY ? "补正" : "待补正"} ${stats.fixed}，对象缺失 ${stats.missing}，失败 ${stats.failed}。`,
  );
  if (!APPLY && stats.fixed > 0) console.log("确认无误后加 --apply 实际执行。");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
