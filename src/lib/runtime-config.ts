// 站点运行配置后台化 —— GitHub OAuth / 存储 / SMTP 邮件，替代 .env 里的运营类配置。
// （站点外观配置见 site-config.ts，两者都走 SiteSetting KV，key 不同。）
// 读取优先级：后台配置 > 旧 .env 回退（迁移期平滑：env 删掉后纯靠后台，未删也不冲突）。
// 模式与 seo-config 一致：schema 只做形状与默认值，输出规范化统一走 sanitizeRuntimeConfig。
import { cache } from "react";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { setS3Runtime } from "@/lib/storage/url";

export const RUNTIME_CONFIG_KEY = "site-runtime";

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
  // 附件去向：auto=跟随存储驱动（chevereto 默认走云盘，其余走驱动）；on=强制云盘；off=强制存储驱动
  attachmentCloud: z.enum(["auto", "on", "off"]).default("auto"),
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
  // ---- 网站管家 AI（OpenAI 兼容 /chat/completions）----
  aiBaseUrl: z.string().default(""),
  aiApiKey: z.string().default(""),
  aiModel: z.string().default(""),
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
    attachmentCloud: ["auto", "on", "off"].includes(config.attachmentCloud)
      ? config.attachmentCloud
      : "auto",
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
    aiBaseUrl: normUrl(config.aiBaseUrl).slice(0, SECRET_MAX),
    aiApiKey: config.aiApiKey.trim().slice(0, SECRET_MAX),
    aiModel: config.aiModel.trim().slice(0, 100),
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
    [c.aiBaseUrl, "AI Base URL"],
  ] as const;
  for (const [v, label] of fields) {
    if (v && !URL_RE.test(v)) issues.push(`${label} 不是合法的 http(s) 地址`);
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

/** 附件是否走云盘（OneDrive）：on/off 强制；auto 跟随存储驱动——chevereto 默认走云盘，其余走驱动 */
export function attachmentCloudEnabled(c: RuntimeConfig): boolean {
  if (c.attachmentCloud === "on") return true;
  if (c.attachmentCloud === "off") return false;
  return c.storageDriver === "chevereto";
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

export function aiBaseUrl(c: RuntimeConfig): string {
  return c.aiBaseUrl || process.env.AI_PROVIDER_BASE_URL || "";
}

export function aiApiKey(c: RuntimeConfig): string {
  return c.aiApiKey || process.env.AI_PROVIDER_API_KEY || "";
}

export function aiModel(c: RuntimeConfig): string {
  return c.aiModel || process.env.AI_PROVIDER_MODEL || "";
}

/**
 * 请求级去重读取（登录页/设置页/上传链路同请求共用一次查询）。
 * 附带把 s3 运行时镜像同步给 storage/url 的同步 publicUrl（client 端无 DB，见其注释）。
 */
export const getRuntimeConfig = cache(async (): Promise<RuntimeConfig> => {
  const row = await prisma.siteSetting.findUnique({ where: { key: RUNTIME_CONFIG_KEY } });
  const cfg = row ? parseRuntimeConfig(safeJson(row.value)) : DEFAULT_RUNTIME_CONFIG;
  // 同步 s3 运行时镜像：driver=s3 且算出公开基址才镜像，否则清掉（切驱动后残留会拼错 URL）
  if (cfg.storageDriver === "s3") {
    const base = s3PublicBase(cfg);
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
