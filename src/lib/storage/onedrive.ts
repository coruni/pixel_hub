// 云端附件驱动器 —— Microsoft Graph app-only（client-credentials）客户端与引用工具。
// 仅服务端模块（import prisma / node:crypto）：不得被任何 client 组件 import。
// 无新增运行时依赖：token 获取与全部 Graph 调用走全局 fetch。
//
// 引用语义：自描述站内路径 /od/{driveId}/{itemPath}
//   itemPath 从驱动器根目录起算 = [rootPath/]YYYYMM/{uuid}.{ext}。
//   下载经 /od/[driveId]/[…key] 网关实时查 Graph 预鉴权下载 URL 后 307，不经本站转发大文件字节。
//   rootPath 只影响新上传落点；存量引用自带完整路径，改 rootPath / 切活跃均不影响旧链接。

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { CloudDrive } from "@prisma/client";

export type { CloudDrive };

// ---------- 环境配置（凭据只走 env，不进数据库） ----------

export type GraphCreds = {
  tenant: string;
  clientId: string;
  clientSecret: string;
  endpoint: string;
  scope: string;
};

export function graphCreds(): GraphCreds | null {
  const tenant = process.env.GRAPH_TENANT_ID?.trim() ?? "";
  const clientId = process.env.GRAPH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GRAPH_CLIENT_SECRET?.trim() ?? "";
  if (!tenant || !clientId || !clientSecret) return null;
  const endpoint = (process.env.GRAPH_ENDPOINT?.trim() || "https://graph.microsoft.com").replace(
    /\/+$/,
    "",
  );
  const scope = process.env.GRAPH_SCOPE?.trim() || `${endpoint}/.default`;
  return { tenant, clientId, clientSecret, endpoint, scope };
}

/** 三件凭据齐备才算启用；否则附件回退原存储（行为同未配置） */
export function graphEnabled(): boolean {
  return !!graphCreds();
}

// ---------- 校验 / 引用工具（纯函数） ----------

/** locator 白名单前缀 + 安全字符集检查（拦截注入）；能过正则只保证安全，可达性由“测试连通”验证 */
export function validateLocator(
  s: string,
): { ok: true; locator: string } | { ok: false; error: string } {
  const t = (s ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!t) return { ok: false, error: "locator 必填（如 drives/<id> 或 sites/<siteId>/drive）" };
  if (/[\s\\"']/.test(t)) return { ok: false, error: "locator 不能含空格、引号或反斜杠" };
  if (!/^(?:drives|sites|users|groups)\//i.test(t))
    return { ok: false, error: "locator 需以 drives/ sites/ users/ groups/ 开头" };
  if (!/^[A-Za-z0-9@._:/(){}[\],-]+$/.test(t))
    return { ok: false, error: "locator 含非法字符（仅字母数字 @._:/(){}[] ,-）" };
  if (/(^|\/)\.\.($|\/)/.test(t)) return { ok: false, error: "locator 不能含 .. 路径段" };
  return { ok: true, locator: t };
}

/** rootPath：空或单段 [A-Za-z0-9._-]，只影响新上传顶层目录 */
export function validateRootPath(
  p: string,
): { ok: true; rootPath: string } | { ok: false; error: string } {
  const t = (p ?? "").trim();
  if (!t) return { ok: true, rootPath: "" };
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(t))
    return { ok: false, error: "rootPath 仅单段，限字母/数字/._-（可留空）" };
  return { ok: true, rootPath: t };
}

/** YYYYMM/uuid.ext —— 月目录 + 随机名，与图片 makeKey 同风格 */
export function cloudRelKey(ext: string): string {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const e = ext.startsWith(".") ? ext : `.${ext}`;
  return `${yyyymm}/${randomUUID()}${e}`;
}

/** itemPath：从驱动器根目录起算（可选 rootPath 前缀 + relKey） */
export function itemPathFor(drive: { rootPath: string }, relKey: string): string {
  return drive.rootPath ? `${drive.rootPath}/${relKey}` : relKey;
}

/** 构造自描述站内引用 /od/{driveId}/{itemPath}（下载按钮存的就是它） */
export function makeCloudRef(driveId: string, itemPath: string): string {
  return `/od/${driveId}/${itemPath.replace(/^\/+/, "")}`;
}

export function parseCloudRef(ref: string): { driveId: string; itemPath: string } | null {
  const m = /^\/od\/([A-Za-z0-9]+)\/(.+)$/.exec(ref);
  return m ? { driveId: m[1], itemPath: m[2].replace(/\\/g, "/") } : null;
}

// ---------- Graph 客户端 ----------

/** Graph 请求错误：带可读文案与 HTTP 状态（probe/上传失败提示用） */
export class GraphError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "GraphError";
    this.status = status;
  }
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

let tokenCache: { token: string; expiresAt: number } | null = null;

/** app-only client_credentials 取 token（提前 60s 视为过期；模块级缓存，Vercel 冷启动自动重取） */
async function requestToken(creds: GraphCreds): Promise<string> {
  const authority = `https://login.microsoftonline.com/${creds.tenant}/oauth2/v2.0/token`;
  const res = await fetch(authority, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: creds.scope,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  if (!res.ok)
    throw new GraphError(`获取 Graph token 失败（HTTP ${res.status}）：${truncate(text, 200)}`);
  const data = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new GraphError("Graph token 响应缺少 access_token");
  const expiresIn =
    typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;
  tokenCache = { token: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  return data.access_token;
}

async function graphToken(force = false): Promise<string> {
  const creds = graphCreds();
  if (!creds) throw new GraphError("GRAPH 未配置（缺 GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET）");
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  return requestToken(creds);
}

type GraphInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  redirect?: RequestInit["redirect"];
};

/** 统一鉴权请求：401 时清 token 重试一次（处理过期/轮换） */
async function graphRequest(url: string, init: GraphInit = {}, retried = false): Promise<Response> {
  const token = await graphToken();
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
    cache: "no-store",
  });
  if (res.status === 401 && !retried) {
    tokenCache = null;
    return graphRequest(url, init, true);
  }
  return res;
}

async function graphErr(res: Response, ctx: string): Promise<GraphError> {
  const raw = await res.text().catch(() => "");
  let detail = raw;
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } };
    if (j.error?.message) detail = j.error.message;
  } catch {
    /* 非 JSON 响应原样展示 */
  }
  let hint = "";
  if (res.status === 403)
    hint = "权限不足：应用需获得该目标 Files.ReadWrite.All（或 Sites.Selected 显式授权）";
  else if (res.status === 404)
    hint = "目标不存在：核对 locator / rootPath（可先用 Graph Explorer 验证该驱动器可达）";
  else if (res.status === 429) hint = "Graph 请求过频，稍后再试";
  const extra = detail && detail !== raw ? `（${truncate(detail, 160)}）` : truncate(detail, 160);
  return new GraphError(
    `${ctx}失败（HTTP ${res.status}）${hint ? `：${hint}` : ""}${extra ? extra : ""}`,
    res.status,
  );
}

function driveRoot(creds: GraphCreds, drive: { locator: string }): string {
  return `${creds.endpoint}/v1.0/${drive.locator}/root`;
}

/** 逐段安全编码（itemPath 各段本已受控，再编码一层防注入） */
function encPath(itemPath: string): string {
  return itemPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

const folderCache = new Set<string>();

/** 确保 itemPath 的各级父目录存在（Graph 的 PUT content 不会自动建目录） */
async function ensureFolders(
  creds: GraphCreds,
  drive: CloudDrive,
  itemPath: string,
): Promise<void> {
  const base = driveRoot(creds, drive);
  const segs = itemPath.split("/").filter(Boolean);
  if (segs.length <= 1) return; // 文件在根目录
  const parents = segs.slice(0, -1);
  let acc = "";
  for (const seg of parents) {
    acc = acc ? `${acc}/${seg}` : seg;
    const cacheKey = `${drive.id}:${acc}`;
    if (folderCache.has(cacheKey)) continue;
    // 目录是否存在
    const check = await graphRequest(`${base}:/${encPath(acc)}?select=id`);
    if (check.ok) {
      folderCache.add(cacheKey);
      continue;
    }
    if (check.status !== 404) throw await graphErr(check, "检查目录");
    // 建目录（父目录 = acc 去掉末段）
    const parent = acc.split("/").slice(0, -1).join("/");
    const createUrl = parent ? `${base}:/${encPath(parent)}:/children` : `${base}/children`;
    const create = await graphRequest(createUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: seg, folder: {} }),
    });
    if (create.status === 409) {
      // 并发创建：nameAlreadyExists 视为成功
    } else if (!create.ok) {
      throw await graphErr(create, "创建目录");
    }
    folderCache.add(cacheKey);
  }
}

export type DriveUploadSession = {
  uploadUrl: string;
  expirationDateTime: string | null;
};

/** 创建 Graph 分片上传会话；uploadUrl 是短期预授权地址，只返回给当前已鉴权请求的浏览器。 */
export async function createDriveUploadSession(
  drive: CloudDrive,
  itemPath: string,
): Promise<DriveUploadSession> {
  const creds = graphCreds();
  if (!creds) throw new GraphError("GRAPH 未配置");
  await ensureFolders(creds, drive, itemPath);
  const url = `${driveRoot(creds, drive)}:/${encPath(itemPath)}:/createUploadSession`;
  const res = await graphRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      item: { "@microsoft.graph.conflictBehavior": "fail" },
    }),
  });
  if (!res.ok) throw await graphErr(res, "创建上传会话");
  const data = (await res.json().catch(() => null)) as {
    uploadUrl?: string;
    expirationDateTime?: string;
  } | null;
  if (!data?.uploadUrl) throw new GraphError("Graph 上传会话响应缺少 uploadUrl");
  return {
    uploadUrl: data.uploadUrl,
    expirationDateTime: data.expirationDateTime ?? null,
  };
}

/** 从 Graph 按路径确认分片上传最终文件已提交且大小一致。 */
export async function verifyDriveUpload(
  drive: CloudDrive,
  itemPath: string,
  expectedSize: number,
): Promise<void> {
  const creds = graphCreds();
  if (!creds) throw new GraphError("GRAPH 未配置");
  const url = `${driveRoot(creds, drive)}:/${encPath(itemPath)}?select=id,size`;
  const res = await graphRequest(url);
  if (res.status === 404) throw new GraphError("OneDrive 文件尚未完成上传", 404);
  if (!res.ok) throw await graphErr(res, "确认上传");
  const data = (await res.json().catch(() => null)) as { id?: string; size?: number } | null;
  if (!data?.id || data.size !== expectedSize) {
    throw new GraphError("OneDrive 文件校验失败：文件大小与上传内容不一致");
  }
}

type DriveUploadTicket = {
  driveId: string;
  itemPath: string;
  size: number;
  name: string;
  mime: string | null;
  userId: string;
  expiresAt: number;
};

function ticketSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (secret) return secret;
  const creds = graphCreds();
  if (creds?.clientSecret) return creds.clientSecret;
  throw new GraphError("缺少上传会话签名密钥");
}

function encodeTicketPart(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signTicket(payload: string): string {
  return createHmac("sha256", ticketSecret()).update(payload).digest("base64url");
}

/** 给完成接口使用的短期签名凭证，不把 uploadUrl 或文件内容交回 Vercel。 */
export function createDriveUploadTicket(input: Omit<DriveUploadTicket, "expiresAt">): string {
  const payload = encodeTicketPart(
    // 250GiB 在慢速网络上可能需要数天；Graph 自身仍会在无活动时过期会话。
    JSON.stringify({ ...input, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 }),
  );
  return `${payload}.${signTicket(payload)}`;
}

export function readDriveUploadTicket(ticket: string, userId: string): DriveUploadTicket {
  const [payload, signature] = (ticket ?? "").split(".");
  if (!payload || !signature) throw new GraphError("上传会话凭证无效", 400);
  const expected = signTicket(payload);
  const actualBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes))
    throw new GraphError("上传会话凭证无效", 400);
  let data: DriveUploadTicket;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DriveUploadTicket;
  } catch {
    throw new GraphError("上传会话凭证无效", 400);
  }
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.userId !== "string" ||
    typeof data.driveId !== "string" ||
    typeof data.itemPath !== "string" ||
    data.userId !== userId ||
    !data.driveId ||
    !data.itemPath ||
    !Number.isSafeInteger(data.size) ||
    data.size <= 0 ||
    !Number.isFinite(data.expiresAt) ||
    data.expiresAt < Date.now()
  )
    throw new GraphError("上传会话已过期或不属于当前用户", 400);
  return data;
}

/** 小文件仍保留单请求上传，供连通性探测和非浏览器服务端调用使用。 */
export async function uploadDriveFile(
  drive: CloudDrive,
  itemPath: string,
  buf: Buffer,
): Promise<void> {
  const creds = graphCreds();
  if (!creds) throw new GraphError("GRAPH 未配置");
  await ensureFolders(creds, drive, itemPath);
  const url = `${driveRoot(creds, drive)}:/${encPath(itemPath)}:/content`;
  const res = await graphRequest(url, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    // undici BodyInit 不接受 Uint8Array<ArrayBufferLike>，经 unknown 透传（零拷贝视图）
    body: buf as unknown as BodyInit,
  });
  if (!res.ok) throw await graphErr(res, "上传");
  await res.arrayBuffer().catch(() => {}); // 放掉响应体
}

/**
 * 取预鉴权下载 URL（浏览器可直接跳转，短时效）：主用 `@microsoft.graph.downloadUrl`，
 * 缺失时回退 `/content` 的 302 Location。404 表示文件不存在返回 null。
 */
export async function resolveDriveDownloadUrl(
  drive: CloudDrive,
  itemPath: string,
): Promise<string | null> {
  const creds = graphCreds();
  if (!creds) throw new GraphError("GRAPH 未配置");
  const base = driveRoot(creds, drive);
  const enc = encPath(itemPath);

  const meta = await graphRequest(`${base}:/${enc}?select=id,@microsoft.graph.downloadUrl`);
  if (meta.status === 404) return null;
  if (!meta.ok) throw await graphErr(meta, "获取下载链接");
  const json = (await meta.json().catch(() => null)) as {
    "@microsoft.graph.downloadUrl"?: string;
  } | null;
  const dl = json?.["@microsoft.graph.downloadUrl"];
  if (dl) return dl;

  // 备用：跟随 /content 响应头的 Location（不转发字节）
  const c = await graphRequest(`${base}:/${enc}:/content`, { redirect: "manual" });
  if (c.status === 404) return null;
  if (c.status >= 300 && c.status < 400) {
    const loc = c.headers.get("location");
    if (loc) return loc;
  }
  if (!c.ok) throw await graphErr(c, "获取下载链接");
  await c.arrayBuffer().catch(() => {});
  throw new GraphError("无法为该文件生成下载链接");
}

/** 删除：先按路径取 item id 再 DELETE；404（两处任一）视为已删除 */
export async function deleteDriveFile(drive: CloudDrive, itemPath: string): Promise<void> {
  const creds = graphCreds();
  if (!creds) throw new GraphError("GRAPH 未配置");
  const base = driveRoot(creds, drive);
  const enc = encPath(itemPath);

  const meta = await graphRequest(`${base}:/${enc}?select=id`);
  if (meta.status === 404) return;
  if (!meta.ok) throw await graphErr(meta, "定位文件");
  const j = (await meta.json().catch(() => null)) as { id?: string } | null;
  if (!j?.id) return;
  const del = await graphRequest(`${creds.endpoint}/v1.0/${drive.locator}/items/${j.id}`, {
    method: "DELETE",
  });
  if (del.status !== 204 && del.status !== 404 && !del.ok) throw await graphErr(del, "删除文件");
}

/** 连通性探测：传一个临时 txt → 取下载链接 → 删掉，全部成功即盘可用 */
export async function probeDrive(
  drive: CloudDrive,
): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const t0 = Date.now();
  const itemPath = itemPathFor(drive, cloudRelKey(".txt"));
  try {
    await uploadDriveFile(drive, itemPath, Buffer.from(`pixel-hub 连通探测 ${randomUUID()}\n`));
    const dl = await resolveDriveDownloadUrl(drive, itemPath);
    await deleteDriveFile(drive, itemPath).catch(() => {});
    if (!dl) throw new GraphError("上传成功但无法取得下载链接");
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    await deleteDriveFile(drive, itemPath).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// ---------- 数据库读取 / 记录（仅服务端） ----------

export async function getCloudDrive(id: string): Promise<CloudDrive | null> {
  return prisma.cloudDrive.findUnique({ where: { id } });
}

/** 当前活跃盘（后台 /admin/drives 标记；无则附件走原存储） */
export async function activeCloudDrive(): Promise<CloudDrive | null> {
  return prisma.cloudDrive.findFirst({ where: { active: true, enabled: true } });
}

/** 引用计数：Media.storageKey / Resource.externalUrl / ResourceVersion.url 以 /od/{id}/ 开头合计 */
export async function countDriveRefs(driveId: string): Promise<number> {
  const prefix = `/od/${driveId}/`;
  const [media, resources, versions] = await Promise.all([
    prisma.media.count({ where: { storageKey: { startsWith: prefix } } }),
    prisma.resource.count({ where: { externalUrl: { startsWith: prefix } } }),
    prisma.resourceVersion.count({ where: { url: { startsWith: prefix } } }),
  ]);
  return media + resources + versions;
}

/** 删除一条已落库的 /od 引用背后的云文件（best-effort：解析失败/盘已删/404 一律静默） */
export async function deleteStoredCloudRef(ref: string): Promise<void> {
  const p = parseCloudRef(ref);
  if (!p) return;
  try {
    const drive = await getCloudDrive(p.driveId);
    if (!drive) return;
    await deleteDriveFile(drive, p.itemPath);
  } catch (e) {
    console.error("[del-cloud-ref]", ref, e);
  }
}

export async function recordDriveOk(id: string): Promise<void> {
  try {
    await prisma.cloudDrive.update({
      where: { id },
      data: { lastError: null, lastOkAt: new Date() },
    });
  } catch (e) {
    console.error("[record-drive-ok]", e);
  }
}

export async function recordDriveError(id: string, message: string): Promise<void> {
  try {
    await prisma.cloudDrive.update({
      where: { id },
      data: { lastError: truncate(message, 1000) },
    });
  } catch (e) {
    console.error("[record-drive-error]", e);
  }
}
