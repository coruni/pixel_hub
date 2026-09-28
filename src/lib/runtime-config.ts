// 站点运行配置后台化 —— GitHub OAuth / 存储 / SMTP 邮件，替代 .env 里的运营类配置。
// （站点外观配置见 site-config.ts，两者都走 SiteSetting KV，key 不同。）
// 读取优先级：后台配置 > 旧 .env 回退（迁移期平滑：env 删掉后纯靠后台，未删也不冲突）。
// 模式与 seo-config 一致：schema 只做形状与默认值，输出规范化统一走 sanitizeRuntimeConfig。
import { cache } from "react";
import { cachedInRequest } from "@/lib/cached-in-request";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { setS3Runtime } from "@/lib/storage/url";
import { S3_MAX_EXTRA_BUCKETS } from "@/lib/storage/bucket-limits";

export const RUNTIME_CONFIG_KEY = "site-runtime";

/** 备用存储桶上限（后台表单与 schema 共用同一常量，见 storage/bucket-limits） */
export { S3_MAX_EXTRA_BUCKETS };

/**
 * 备用存储桶条目。除 `bucket`（必填）与两个开关外，**留空即继承主配置**：
 * 同一账号多桶只填桶名即可；不同账号/服务商再各自填 Endpoint 与凭据。
 * `full` = 已满标记：上传时跳过（见 s3UploadBuckets）。
 */
function coerceBucketEntry(raw: unknown): S3BucketEntry {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  return {
    label: str(o.label),
    bucket: str(o.bucket),
    endpoint: str(o.endpoint),
    region: str(o.region),
    publicBase: str(o.publicBase),
    accessKeyId: str(o.accessKeyId),
    secretAccessKey: str(o.secretAccessKey),
    aclPrivate: o.aclPrivate === true,
    full: o.full === true,
  };
}
export const s3BucketEntrySchema = z.object({
  label: z.string().default(""),
  bucket: z.string().default(""),
  endpoint: z.string().default(""),
  region: z.string().default(""),
  publicBase: z.string().default(""),
  accessKeyId: z.string().default(""),
  secretAccessKey: z.string().default(""),
  aclPrivate: z.boolean().default(false),
  full: z.boolean().default(false),
});

export type S3BucketEntry = z.infer<typeof s3BucketEntrySchema>;

export const runtimeConfigSchema = z.object({
  // ---- 登录：GitHub OAuth App ----
  githubId: z.string().default(""),
  githubSecret: z.string().default(""),
  // ---- 存储 ----
  // local（默认，落 public/uploads）| s3 | chevereto
  storageDriver: z.string().default("local"),
  cheveretoBase: z.string().default(""),
  cheveretoApiKey: z.string().default(""),
  s3Endpoint: z.string().default(""),
  s3Region: z.string().default(""),
  s3Bucket: z.string().default(""),
  s3AccessKeyId: z.string().default(""),
  s3SecretAccessKey: z.string().default(""),
  s3PublicBase: z.string().default(""),
  s3AclPrivate: z.boolean().default(false),
  // 主桶「已满」标记 + 备用桶列表：上传按「主桶 → 备用桶 1…N」顺序挑第一个未标记满的
  // （见 s3UploadBuckets/s3BucketSpecs）。两者都不填时行为与单桶时代完全一致。
  s3BucketFull: z.boolean().default(false),
  // 用 preprocess 把每一项**强制掰成合法形状**：脏数据（不是数组、字段类型不对）只影响这一项，
  // 否则 safeParse 失败会让**整份**运行配置回退默认值 —— 加个桶把站点配置清空是不可接受的失败模式。
  // 在 preprocess 里**先截断再去重**：写成 `.max(N)` 的话超限会直接让整份 schema 校验失败，
  // 又绕回「整份配置回退默认值」那条路（实测过）。
  s3ExtraBuckets: z
    .preprocess(
      (v) => (Array.isArray(v) ? v.slice(0, S3_MAX_EXTRA_BUCKETS).map(coerceBucketEntry) : []),
      z.array(s3BucketEntrySchema),
    )
    .default([]),
  // 附件去向：auto=跟随存储驱动（chevereto 默认走云盘，其余走驱动）；on=强制云盘；off=强制存储驱动
  attachmentCloud: z.enum(["auto", "on", "off"]).default("auto"),
  // 音视频去向：音乐/视频资源上传的来源文件走哪（on/off 独立；auto = 跟随 attachmentCloud 的结论）
  avCloud: z.enum(["auto", "on", "off"]).default("auto"),
  // ---- SMTP 邮件 ----
  smtpHost: z.string().default(""),
  smtpPort: z.string().default(""), // 空 = 587
  smtpUser: z.string().default(""),
  smtpPass: z.string().default(""),
  mailFrom: z.string().default(""), // 空 = noreply@站点域名
  mailNotify: z.boolean().default(false), // 评论回复/审核结果邮件通知开关
  emailCodeRequired: z.boolean().default(false), // 注册需邮箱验证码（还需 SMTP 可用才生效）
  // ---- 云盘附件：Microsoft Graph app-only 凭据（驱动器条目在 CloudDrive 表，见云盘管理页）----
  graphTenant: z.string().default(""),
  graphClientId: z.string().default(""),
  graphClientSecret: z.string().default(""),
  graphEndpoint: z.string().default(""), // 空 = https://graph.microsoft.com
  graphScope: z.string().default(""), // 空 = {endpoint}/.default
  // ---- 全文搜索（SEARCH_* / ES_* → 后台化；留空 = 默认或回退旧 .env）----
  searchEngine: z.string().default(""), // postgres（默认，Supabase pg_trgm）| elasticsearch
  esUrl: z.string().default(""),
  esIndex: z.string().default(""), // 空 = pixel-hub-resources
  esApiKey: z.string().default(""), // 与账号密码二选一
  esUsername: z.string().default(""),
  esPassword: z.string().default(""),
  esAnalyzer: z.string().default(""), // 空 = ES 默认分析器；中文生产建议 ik_max_word
  searchCandidateLimit: z.string().default(""), // 候选 id 上限，空 = 5000（1000–50000）
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = runtimeConfigSchema.parse({});

const SECRET_MAX = 200;
const URL_RE = /^https?:\/\/\S+$/i;

/** 规范化输出：trim、URL 去尾斜杠、端口/驱动合法性收敛；密钥仅做长度钳制 */
export function sanitizeRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  const driver = ["local", "s3", "chevereto"].includes(config.storageDriver)
    ? config.storageDriver
    : "local";
  const port = config.smtpPort.trim();
  const normUrl = (v: string) => v.trim().replace(/\/+$/, "");
  const engineRaw = config.searchEngine.trim().toLowerCase();
  const engine = engineRaw === "elasticsearch" ? "elasticsearch" : engineRaw === "postgres" ? "postgres" : "";
  const esIndex = config.esIndex.trim().replace(/[^a-z0-9_.\-]/gi, "").toLowerCase().slice(0, 100);
  const limitRaw = config.searchCandidateLimit.trim();
  const limit = /^\d+$/.test(limitRaw) ? String(Math.min(50000, Math.max(1000, Number(limitRaw)))) : "";
  // 备用桶：逐项 trim/钳长后丢掉没填桶名的空行（半填的行不值得落库，UI 侧同样会过滤）
  const extraBuckets = config.s3ExtraBuckets
    .map((e) => ({
      label: e.label.trim().slice(0, 40),
      bucket: e.bucket.trim().slice(0, 200),
      endpoint: normUrl(e.endpoint).slice(0, SECRET_MAX),
      region: e.region.trim().slice(0, 64),
      publicBase: normUrl(e.publicBase).slice(0, SECRET_MAX),
      accessKeyId: e.accessKeyId.trim().slice(0, SECRET_MAX),
      secretAccessKey: e.secretAccessKey.trim().slice(0, SECRET_MAX),
      aclPrivate: e.aclPrivate === true,
      full: e.full === true,
    }))
    .filter((e) => e.bucket !== "")
    .slice(0, S3_MAX_EXTRA_BUCKETS);
  return {
    githubId: config.githubId.trim().slice(0, SECRET_MAX),
    githubSecret: config.githubSecret.trim().slice(0, SECRET_MAX),
    storageDriver: driver,
    cheveretoBase: normUrl(config.cheveretoBase).slice(0, SECRET_MAX),
    cheveretoApiKey: config.cheveretoApiKey.trim().slice(0, SECRET_MAX),
    s3Endpoint: normUrl(config.s3Endpoint).slice(0, SECRET_MAX),
    s3Region: config.s3Region.trim().slice(0, 64),
    s3Bucket: config.s3Bucket.trim().slice(0, 200),
    s3AccessKeyId: config.s3AccessKeyId.trim().slice(0, SECRET_MAX),
    s3SecretAccessKey: config.s3SecretAccessKey.trim().slice(0, SECRET_MAX),
    s3PublicBase: normUrl(config.s3PublicBase).slice(0, SECRET_MAX),
    s3AclPrivate: config.s3AclPrivate === true,
    s3BucketFull: config.s3BucketFull === true,
    s3ExtraBuckets: extraBuckets,
    attachmentCloud: ["auto", "on", "off"].includes(config.attachmentCloud)
      ? config.attachmentCloud
      : "auto",
    avCloud: ["auto", "on", "off"].includes(config.avCloud) ? config.avCloud : "auto",
    smtpHost: config.smtpHost.trim().slice(0, 200),
    smtpPort: /^\d{1,5}$/.test(port) ? port : "",
    smtpUser: config.smtpUser.trim().slice(0, SECRET_MAX),
    smtpPass: config.smtpPass.trim().slice(0, SECRET_MAX),
    mailFrom: config.mailFrom.trim().slice(0, 200),
    mailNotify: config.mailNotify === true,
    emailCodeRequired: config.emailCodeRequired === true,
    graphTenant: config.graphTenant.trim().slice(0, 200),
    graphClientId: config.graphClientId.trim().slice(0, SECRET_MAX),
    graphClientSecret: config.graphClientSecret.trim().slice(0, SECRET_MAX),
    graphEndpoint: normUrl(config.graphEndpoint).slice(0, SECRET_MAX),
    graphScope: config.graphScope.trim().slice(0, SECRET_MAX),
    searchEngine: engine,
    esUrl: normUrl(config.esUrl).slice(0, SECRET_MAX),
    esIndex,
    esApiKey: config.esApiKey.trim().slice(0, SECRET_MAX),
    esUsername: config.esUsername.trim().slice(0, SECRET_MAX),
    esPassword: config.esPassword.trim().slice(0, SECRET_MAX),
    esAnalyzer: config.esAnalyzer.trim().slice(0, 100),
    searchCandidateLimit: limit,
  };
}

/** URL 字段校验（表单侧提示用）：填了就必须是合法 http(s) URL */
export function runtimeConfigIssues(c: RuntimeConfig): string[] {
  const issues: string[] = [];
  const fields = [
    [c.cheveretoBase, "Chevereto 站点地址"],
    [c.s3Endpoint, "S3 Endpoint"],
    [c.s3PublicBase, "S3 公开访问基址"],
    [c.graphEndpoint, "Graph Endpoint"],
    [c.esUrl, "Elasticsearch 地址"],
  ] as const;
  for (const [v, label] of fields) {
    if (v && !URL_RE.test(v)) issues.push(`${label} 不是合法的 http(s) 地址`);
  }
  // 备用桶：URL 字段同样要合法；桶名不能带空格/斜杠（会拼坏公开访问基址）
  c.s3ExtraBuckets.forEach((b, i) => {
    const who = `备用存储桶 ${i + 1}「${b.label || b.bucket}」`;
    if (b.endpoint && !URL_RE.test(b.endpoint)) issues.push(`${who} 的 Endpoint 不是合法的 http(s) 地址`);
    if (b.publicBase && !URL_RE.test(b.publicBase))
      issues.push(`${who} 的公开访问基址不是合法的 http(s) 地址`);
    if (!/^[A-Za-z0-9._-]+$/.test(b.bucket))
      issues.push(`${who} 的桶名含非法字符（只允许字母、数字、. _ -）`);
  });
  // 同一 Endpoint 下同名桶重复配置 = 白搭一趟（还会让「满了切下一个」失去意义）
  const seen = new Set<string>();
  for (const s of s3BucketSpecs(c)) {
    const id = `${s.endpoint}|${s.bucket}`.toLowerCase();
    if (seen.has(id)) issues.push(`存储桶「${s.bucket}」重复配置（Endpoint 相同即为同一个桶）`);
    seen.add(id);
  }
  return issues;
}

/** 解析落库 JSON：非法/缺失字段一律回退默认，不抛错 */
export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  const result = runtimeConfigSchema.safeParse(value ?? {});
  if (!result.success) return DEFAULT_RUNTIME_CONFIG;
  return sanitizeRuntimeConfig(result.data);
}

export function serializeRuntimeConfig(config: RuntimeConfig): string {
  return JSON.stringify(sanitizeRuntimeConfig(runtimeConfigSchema.parse(config)));
}

// ---- 生效值解析（后台配置 > env 回退）----
// 集中在这里而不是散在各调用点，回退规则只写一遍。

export function githubClientId(c: RuntimeConfig): string {
  return c.githubId || process.env.GITHUB_ID || "";
}

export function githubClientSecret(c: RuntimeConfig): string {
  return c.githubSecret || process.env.GITHUB_SECRET || "";
}

export function cheveretoBase(c: RuntimeConfig): string {
  return c.cheveretoBase || process.env.CHEVERETO_BASE || "";
}

export function cheveretoApiKey(c: RuntimeConfig): string {
  return c.cheveretoApiKey || process.env.CHEVERETO_API_KEY || "";
}

export function s3Endpoint(c: RuntimeConfig): string {
  return c.s3Endpoint || process.env.S3_ENDPOINT || "";
}

export function s3Bucket(c: RuntimeConfig): string {
  return c.s3Bucket || process.env.S3_BUCKET || "";
}

export function s3PublicBase(c: RuntimeConfig): string {
  const endpoint = s3Endpoint(c);
  const bucket = s3Bucket(c);
  return (
    c.s3PublicBase ||
    process.env.S3_PUBLIC_BASE ||
    (endpoint ? `${endpoint}/${bucket}` : "")
  ).replace(/\/+$/, "");
}

/**
 * 生效的存储桶清单：`[主桶, 备用桶 1…N]`（顺序 = 上传优先级）。
 *
 * 备用桶**逐字段继承主配置**（Endpoint / Region / 凭据 / 私有桶），只填桶名即可用同一账号多桶；
 * 不同服务商再各自覆盖。这样「加一个桶」的最小操作就是填一个桶名，不用把凭据抄一遍。
 * 主桶桶名为空（未配置 S3）时返回空数组 —— 调用方据此报「未配置 S3」而不是发一个空桶请求。
 */
export type S3BucketSpec = {
  /** 稳定标识：primary | extra:<下标>，用于 client 复用与日志 */
  id: string;
  label: string;
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 公开访问基址（末尾无斜杠）；空 = 该桶不可用，put 会跳到下一个桶 */
  publicBase: string;
  aclPrivate: boolean;
  /** 已满：配了多桶时跳过此桶 */
  full: boolean;
};

export function s3BucketSpecs(c: RuntimeConfig): S3BucketSpec[] {
  const endpoint = s3Endpoint(c);
  const region = c.s3Region || process.env.S3_REGION || "auto";
  const accessKeyId = c.s3AccessKeyId || process.env.S3_ACCESS_KEY_ID || "";
  const secretAccessKey = c.s3SecretAccessKey || process.env.S3_SECRET_ACCESS_KEY || "";
  const specs: S3BucketSpec[] = [];
  const bucket = s3Bucket(c);
  if (bucket) {
    specs.push({
      id: "primary",
      label: "主存储桶",
      bucket,
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      publicBase: s3PublicBase(c),
      aclPrivate: c.s3AclPrivate === true,
      full: c.s3BucketFull === true,
    });
  }
  c.s3ExtraBuckets.forEach((e, i) => {
    const ep = (e.endpoint || endpoint).replace(/\/+$/, "");
    specs.push({
      id: `extra:${i}`,
      label: e.label || `备用桶 ${i + 1}`,
      bucket: e.bucket,
      endpoint: ep,
      region: e.region || region,
      accessKeyId: e.accessKeyId || accessKeyId,
      secretAccessKey: e.secretAccessKey || secretAccessKey,
      publicBase: (e.publicBase || (ep ? `${ep}/${e.bucket}` : "")).replace(/\/+$/, ""),
      // 私有桶只能「跟随主配置」而不能被单独关掉：公开基址指 CDN 的部署里，
      // 备用桶若漏设 public-read 反而更安全，不该让一个漏勾的开关把对象公开出去。
      aclPrivate: e.aclPrivate === true || c.s3AclPrivate === true,
      full: e.full === true,
    });
  });
  return specs;
}

/**
 * 上传候选桶（按优先级）：跳过所有标记「已满」的桶。
 * 全满时抛错而不是硬塞进满桶 —— 让失败信息是「所有桶都满了」，而不是存储服务商的配额报错。
 */
export function s3UploadBuckets(c: RuntimeConfig): S3BucketSpec[] {
  const all = s3BucketSpecs(c);
  const open = all.filter((s) => !s.full);
  if (all.length > 0 && open.length === 0)
    throw new Error("所有存储桶都已标记「已满」：请在后台新增存储桶或取消已满标记");
  return open;
}

/** 附件是否走云盘（OneDrive）：on/off 强制；auto 跟随存储驱动——chevereto 默认走云盘，其余走驱动 */
export function attachmentCloudEnabled(c: RuntimeConfig): boolean {
  if (c.attachmentCloud === "on") return true;
  if (c.attachmentCloud === "off") return false;
  return c.storageDriver === "chevereto";
}

/**
 * 音视频（音乐/视频资源的上传文件）是否走云盘（OneDrive）。
 * on/off 强制；**auto 跟随附件去向**，与 attachmentCloud 的 auto 同一个答案。
 *
 * 为什么不是各自看 storageDriver：音视频与附件只是体积档位不同，落点没理由分家。
 * 两个开关各自 auto 时，把附件设成 on 而音视频留 auto，就会出现「小附件进云盘、
 * 大视频退回单请求通道」——恰恰是最需要云盘的那一类走了最窄的通道。
 * 未配置 Graph 或未标记活跃盘时，两者都会自动回退存储驱动（见 resolveUploadTarget）。
 */
export function avCloudEnabled(c: RuntimeConfig): boolean {
  if (c.avCloud === "on") return true;
  if (c.avCloud === "off") return false;
  return attachmentCloudEnabled(c);
}

export function graphTenant(c: RuntimeConfig): string {
  return c.graphTenant || process.env.GRAPH_TENANT_ID || "";
}

export function graphClientId(c: RuntimeConfig): string {
  return c.graphClientId || process.env.GRAPH_CLIENT_ID || "";
}

export function graphClientSecret(c: RuntimeConfig): string {
  return c.graphClientSecret || process.env.GRAPH_CLIENT_SECRET || "";
}

export function graphEndpoint(c: RuntimeConfig): string {
  return (c.graphEndpoint || process.env.GRAPH_ENDPOINT || "https://graph.microsoft.com").replace(
    /\/+$/,
    "",
  );
}

export function graphScope(c: RuntimeConfig): string {
  return c.graphScope || process.env.GRAPH_SCOPE || `${graphEndpoint(c)}/.default`;
}

// ---- 全文搜索生效值（后台 > 旧 .env 回退；env 删掉后纯靠后台）----

export function searchEngineName(c: RuntimeConfig): "postgres" | "elasticsearch" {
  const raw = (c.searchEngine || process.env.SEARCH_ENGINE || "postgres").trim().toLowerCase();
  return raw === "elasticsearch" ? "elasticsearch" : "postgres";
}

export function esUrl(c: RuntimeConfig): string {
  return c.esUrl || process.env.ES_URL || "";
}

export function esIndex(c: RuntimeConfig): string {
  const idx = (c.esIndex || process.env.ES_INDEX || "pixel-hub-resources").trim();
  return idx.replace(/[^a-z0-9_.\-]/gi, "").toLowerCase() || "pixel-hub-resources";
}

export function esApiKey(c: RuntimeConfig): string {
  return c.esApiKey || process.env.ES_API_KEY || "";
}

export function esUsername(c: RuntimeConfig): string {
  return c.esUsername || process.env.ES_USERNAME || "";
}

export function esPassword(c: RuntimeConfig): string {
  return c.esPassword || process.env.ES_PASSWORD || "";
}

export function esAnalyzer(c: RuntimeConfig): string {
  return (c.esAnalyzer || process.env.SEARCH_ES_ANALYZER || "").trim();
}

export function searchCandidateLimit(c: RuntimeConfig): number {
  const raw = (c.searchCandidateLimit || process.env.SEARCH_CANDIDATE_LIMIT || "5000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return 5000;
  return Math.min(50_000, Math.max(1000, Math.trunc(n)));
}

/** 运行配置跨请求缓存标签；后台保存后主动失效。 */
export const RUNTIME_CONFIG_CACHE_TAG = "config:runtime";

const readCachedRuntimeConfig = cachedInRequest(
  async (): Promise<RuntimeConfig> => {
    const row = await prisma.siteSetting.findUnique({ where: { key: RUNTIME_CONFIG_KEY } });
    return row ? parseRuntimeConfig(safeJson(row.value)) : DEFAULT_RUNTIME_CONFIG;
  },
  ["runtime-config"],
  { tags: [RUNTIME_CONFIG_CACHE_TAG], revalidate: 300 },
);

/**
 * 请求级去重读取（登录页/设置页/上传链路同请求共用一次查询）。
 * 附带把 s3 运行时镜像同步给 storage/url 的同步 publicUrl（client 端无 DB，见其注释）。
 * 镜像同步放在缓存函数外，避免跨请求命中 Data Cache 时跳过进程内状态初始化。
 */
export const getRuntimeConfig = cache(async (): Promise<RuntimeConfig> => {
  const cfg = await readCachedRuntimeConfig();
  // 同步 s3 运行时镜像：driver=s3 且算出公开基址才镜像，否则清掉（切驱动后残留会拼错 URL）
  if (cfg.storageDriver === "s3") {
    // 取**生效链第一个桶**的基址：有主桶时与旧行为逐字相同；只配了备用桶（无主桶）时也指向对的那个桶
    const base = s3BucketSpecs(cfg)[0]?.publicBase ?? "";
    setS3Runtime(base ? { driver: "s3", base } : null);
  } else {
    setS3Runtime(null);
  }
  return cfg;
});

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 后台编辑用：配置 + 乐观锁版本（行不存在时 version=0，首建后自增） */
export async function getRuntimeConfigWithVersion(): Promise<{
  config: RuntimeConfig;
  version: number;
}> {
  const row = await prisma.siteSetting.findUnique({ where: { key: RUNTIME_CONFIG_KEY } });
  if (!row) return { config: DEFAULT_RUNTIME_CONFIG, version: 0 };
  return { config: parseRuntimeConfig(safeJson(row.value)), version: row.version };
}
