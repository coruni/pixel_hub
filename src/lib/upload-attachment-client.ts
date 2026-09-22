"use client";

import { GRAPH_CHUNK_BYTES, snapChunkBytes } from "@/lib/upload-config";

export type AttachmentUploadResult = { url: string; name: string; size: number };

/** 上传去向：附件 / 音频 / 视频。决定服务端的后缀白名单与云盘开关（均由后台配置驱动） */
export type UploadKind = "attachment" | "music" | "video";

/** 上传可选控制。signal 供调用方取消（离开页面、切换文件、用户点取消） */
export type UploadOptions = { signal?: AbortSignal };

type UploadSessionResponse = {
  ok: boolean;
  code?: string;
  error?: string;
  /** "driver" = 无云盘但存储层支持流式，改用本站流式直传 */
  mode?: string;
  ticket?: string;
  uploadUrl?: string;
  chunkSize?: number;
  maxBytes?: number;
  /** 命中重复上传（同用户同名同大小）：服务端直接给出已完成文件，无需再上传 */
  deduped?: boolean;
  url?: string;
  name?: string;
  size?: number;
};

const MAX_RETRIES = 4;

/** 重试退避上限：Graph 的 Retry-After 偶尔给到分钟级，但不该让用户干等更久 */
const MAX_BACKOFF_MS = 60_000;

/**
 * 分片「无进展」容忍时长：每收到一次上传进度事件就重置，衡量的是**卡住多久**而不是
 * **传了多久**——慢链路不会被误杀，真假死能及时重试。仅在上传已开始推进后启用。
 */
const STALL_TIMEOUT_MS = 60_000;

/**
 * 单请求绝对上限兜底。部分代理会吞掉上传进度事件，此时没有任何「是否还活着」的判据，
 * 只能靠总时长兜底——所以它必须足够大，不能把一条正常但缓慢的链路判死。
 */
const HARD_TIMEOUT_MS = 30 * 60_000;

/** 调用方主动取消：不重试，直接冒泡 */
export class UploadCancelledError extends Error {
  constructor(message: string) {
    super(message);
    // 不设 name 的话日志/监控里只会显示 "Error"，排查时区分不出是取消还是真失败
    this.name = "UploadCancelledError";
  }
}

/** 网络中断 / 长时间无进展 / 超时：可重试 */
class TransferInterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferInterruptedError";
  }
}

// ---------- 小工具 ----------

async function responseJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function parseJsonText(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Graph 错误响应是 `{"error":{"code","message"}}`，直接甩原始 JSON 给用户等于没说 */
function graphErrorText(text: string): string {
  const err = parseJsonText(text)?.error;
  if (err && typeof err === "object") {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return text.slice(0, 300);
}

/** Retry-After 可能是秒数也可能是 HTTP 日期；只认秒数，解析不出来就交给指数退避 */
function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null;
  const secs = Number(raw.trim());
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : null;
}

/** 优先听服务端给的 Retry-After，拿不到才用指数退避 */
function backoffMs(retryAfterMs: number | null, attempt: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, MAX_BACKOFF_MS);
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

/** 可取消的等待：用户点了取消不该还卡在退避里 */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new UploadCancelledError("上传已取消"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new UploadCancelledError("上传已取消"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 单调递增的百分比上报。重试对齐时已发送字节可能倒退，进度条不能跟着退——
 * 那看起来像「上传失败重来」，实际上只是把最后一片重发了一次。
 * 传完之前封顶 99：100 只由服务端确认完成后的调用方发出。
 */
function createProgressReporter(total: number, onProgress?: (percent: number) => void) {
  let last = 0;
  return (sent: number) => {
    if (!onProgress || total <= 0) return;
    const pct = Math.min(99, Math.floor((sent / total) * 100));
    if (pct > last) {
      last = pct;
      onProgress(pct);
    }
  };
}

// ---------- 带进度 / 超时 / 取消的 PUT 原语 ----------

type PutOutcome = { status: number; retryAfterMs: number | null; text: string };

/**
 * 用 XHR 而不是 fetch：fetch 读不到上传进度（ReadableStream 请求体在浏览器里拿不到已发送
 * 字节数），大文件若没有进度条，用户只会看到界面卡住。XHR 还自带 timeout 和 abort，
 * 正好凑齐「进度 + 超时 + 取消」三件套。
 *
 * 超时分两层：先看「多久没有推进」（STALL_TIMEOUT_MS），再看总时长兜底（HARD_TIMEOUT_MS）。
 */
function putBlob(
  url: string,
  body: Blob,
  opts: {
    headers?: Record<string, string>;
    /** 已发送字节的绝对基准（分片场景 = 分片起始偏移），用于拼出全局进度 */
    base?: number;
    onSent?: (sentBytes: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<PutOutcome> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new UploadCancelledError("上传已取消"));

    const base = opts.base ?? 0;
    const xhr = new XMLHttpRequest();
    let settled = false;
    let sawProgress = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(stallTimer);
      xhr.upload.onprogress = null;
      opts.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const armStall = () => {
      clearTimeout(stallTimer);
      // 一次进度事件都没收到过时，无法区分「慢」和「死」，交给 xhr.timeout 兜底；
      // 否则会把一条正常但缓慢的上传误判成假死并反复重传。
      if (!sawProgress) return;
      stallTimer = setTimeout(() => {
        // 先 settle 再 abort：abort 触发的 onabort 是排队事件，先落定能保证
        // 抛出去的是「无进展」而不是被 onabort 的兜底文案盖掉
        finish(() => reject(new TransferInterruptedError("上传长时间无进展，已中断重试")));
        xhr.abort();
      }, STALL_TIMEOUT_MS);
    };
    function onAbort() {
      finish(() => reject(new UploadCancelledError("上传已取消")));
      xhr.abort();
    }

    xhr.open("PUT", url);
    xhr.timeout = HARD_TIMEOUT_MS;
    for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v);

    xhr.upload.onprogress = (e) => {
      sawProgress = true;
      armStall();
      if (e.lengthComputable && e.loaded > 0) opts.onSent?.(base + e.loaded);
    };
    xhr.onload = () =>
      finish(() =>
        resolve({
          status: xhr.status,
          // 跨域响应未必暴露 Retry-After，取不到就返回 null，退避自动降级为指数退避
          retryAfterMs: parseRetryAfter(xhr.getResponseHeader("retry-after")),
          text: xhr.responseText ?? "",
        }),
      );
    xhr.onerror = () =>
      finish(() => reject(new TransferInterruptedError("网络中断，上传未完成，请重试")));
    xhr.ontimeout = () =>
      finish(() => reject(new TransferInterruptedError("上传超时，请重试")));
    // 走到这里说明 abort 不是我们自己发起的（自己发起时 settled 已为 true）
    xhr.onabort = () =>
      finish(() => reject(new TransferInterruptedError("上传被中断，请重试")));

    opts.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(body);
  });
}

// ---------- OneDrive Graph 分片 ----------

/**
 * nextExpectedRanges 形如 `["12345-", "77829-99375"]`（服务端可能返回多段空洞），
 * 取最小起点作为续传位置。
 */
function firstRangeStart(v: unknown): number | null {
  if (!Array.isArray(v)) return null;
  let min: number | null = null;
  for (const item of v) {
    if (typeof item !== "string") continue;
    const start = Number(item.split("-")[0]);
    if (!Number.isSafeInteger(start) || start < 0) continue;
    if (min === null || start < min) min = start;
  }
  return min;
}

/** 查询会话当前状态（Graph 允许对 uploadUrl 直接 GET），返回服务端期望的下一个字节偏移 */
async function fetchNextOffset(
  uploadUrl: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const res = await fetch(uploadUrl, { method: "GET", signal });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { nextExpectedRanges?: unknown } | null;
    return firstRangeStart(data?.nextExpectedRanges);
  } catch {
    // 用户取消时 fetch 抛的是 DOMException，这里统一转成可展示的取消错误
    if (signal?.aborted) throw new UploadCancelledError("上传已取消");
    return null;
  }
}

type RangeOutcome = { done: true } | { done: false; nextOffset: number };

/**
 * 发送一片 [offset, end)，自带重试。返回服务端权威的下一个偏移。
 *
 * 重试的关键不是「再发一遍」，而是**先问服务端到底收到哪了**：5xx / 416 往往意味着这一片
 * 其实已经落库，照着旧区间重发会被再拒一次，越重试越糟。
 */
async function sendRange(
  uploadUrl: string,
  file: File,
  offset: number,
  end: number,
  onSent: (sentBytes: number) => void,
  signal?: AbortSignal,
): Promise<RangeOutcome> {
  const chunk = file.slice(offset, end);
  const headers = {
    "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`,
    "Content-Type": "application/octet-stream",
  };

  for (let attempt = 0; ; attempt += 1) {
    let outcome: PutOutcome | null = null;
    let failure: Error | null = null;

    try {
      outcome = await putBlob(uploadUrl, chunk, { headers, base: offset, onSent, signal });
    } catch (e) {
      // 用户取消：立刻冒泡，不占用重试次数
      if (e instanceof UploadCancelledError) throw e;
      failure = e instanceof Error ? e : new TransferInterruptedError("上传失败，请重试");
    }

    if (outcome) {
      // 200/201 = 整个文件已提交，Graph 只会在最后一片返回它。若在中间片收到，
      // 说明链路上有网关把 202 折叠成了 200——按「本片已收下」继续推进，别提前收工。
      if (outcome.status === 200 || outcome.status === 201) {
        if (end < file.size) return { done: false, nextOffset: end };
        return { done: true };
      }
      if (outcome.status === 202) {
        const next = firstRangeStart(parseJsonText(outcome.text)?.nextExpectedRanges);
        // 服务端明确指到了更靠后的位置就听它的（可能只收下了本片的一部分）；
        // 没给出有效值就按本片整段已收下推进
        if (next !== null && next > offset)
          return { done: false, nextOffset: Math.min(next, file.size) };
        return { done: false, nextOffset: end };
      }
      // 416 = 服务端已有这一段（重复提交）；429/5xx = 可重试；其余按硬失败处理
      const retryable =
        outcome.status === 416 || outcome.status === 429 || outcome.status >= 500;
      if (!retryable)
        throw new Error(
          graphErrorText(outcome.text) || `OneDrive 分片上传失败（HTTP ${outcome.status}）`,
        );
      failure = new TransferInterruptedError(
        graphErrorText(outcome.text) || `OneDrive 分片上传失败（HTTP ${outcome.status}）`,
      );
    }

    if (attempt >= MAX_RETRIES) throw failure ?? new Error("上传失败，请重试");
    await wait(backoffMs(outcome?.retryAfterMs ?? null, attempt), signal);

    // 重试前对齐：服务端期望的偏移若已前进，说明这一片其实收下了，直接跳到它指的位置
    const aligned = await fetchNextOffset(uploadUrl, signal);
    if (aligned !== null && aligned !== offset)
      return { done: false, nextOffset: Math.min(Math.max(aligned, 0), file.size) };
  }
}

/** 走 Graph 上传会话把文件分片推上去；失败抛错，成功返回 void */
async function uploadViaGraphSession(
  uploadUrl: string,
  chunkSizeHint: number | undefined,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const chunkSize = snapChunkBytes(chunkSizeHint ?? GRAPH_CHUNK_BYTES);
  const report = createProgressReporter(file.size, onProgress);

  // 防御性上限：服务端若给出自相矛盾的偏移，宁可报错也不要无限循环重传
  const maxRanges = Math.ceil(file.size / chunkSize) * 4 + 16;
  let offset = 0;
  let ranges = 0;

  while (offset < file.size) {
    if (signal?.aborted) throw new UploadCancelledError("上传已取消");
    if (++ranges > maxRanges) throw new Error("上传会话状态异常，请重新上传");

    const end = Math.min(offset + chunkSize, file.size);
    const outcome = await sendRange(uploadUrl, file, offset, end, report, signal);
    if (outcome.done) {
      report(file.size);
      return;
    }
    report(outcome.nextOffset);
    // sendRange 只会返回两个来源的偏移：202 的 nextExpectedRanges（必然 > offset）
    // 或重试对齐后的服务端状态（必然 ≠ offset）。两者都可以直接采信——包括服务端
    // 要求回退的情况，那意味着前一段其实没落库，必须重传。回退由 maxRanges 兜住。
    offset = outcome.nextOffset;
  }
}

// ---------- 其余两条通道 ----------

/**
 * 把文件作为「整个请求体」PUT 上去（`/attachment/stream`）。
 * 服务端边收边落盘，所以这里不做分片——分片能力见流式通道自己的实现。
 */
async function putRawBody(
  url: string,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const report = createProgressReporter(file.size, onProgress);
  const outcome = await putBlob(url, file, {
    headers: { "content-type": "application/octet-stream" },
    onSent: report,
    signal,
  });
  const data = parseJsonText(outcome.text) ?? {};
  if (outcome.status >= 200 && outcome.status < 300 && data.ok === true) return data;
  throw new Error(
    (data.error as string) || `文件上传失败（HTTP ${outcome.status}）`,
  );
}

async function postLegacyAttachment(
  file: File,
  kind: UploadKind,
  signal?: AbortSignal,
): Promise<AttachmentUploadResult> {
  const fd = new FormData();
  fd.set("file", file);
  if (kind !== "attachment") fd.set("kind", kind);
  const res = await fetch("/api/upload/attachment", { method: "POST", body: fd, signal });
  const data = await responseJson(res);
  if (!res.ok || data.ok !== true) {
    const detail = (data.error as string) || "";
    // 413 通常是「文件超过了这条通道的承载上限」（未走云盘时的单请求直传），
    // 只说「文件上传失败」等于没说——把状态码带出来，用户和运维才知道往哪查。
    if (res.status === 413)
      throw new Error(detail || "文件过大，当前上传通道无法承载，请改用流式直传或压缩体积");
    throw new Error(detail || `文件上传失败（HTTP ${res.status}）`);
  }
  return {
    url: data.url as string,
    name: (data.name as string) || file.name,
    size: data.size as number,
  };
}

// ---------- 调度器 ----------

/**
 * 大文件上传的调度器。三条通道，由服务端 `/attachment/session` 的回答决定走哪条：
 *
 * 1. 云盘可用 → 浏览器直传 Graph 分片，本站只处理小 JSON 请求；
 * 2. 无云盘但存储层支持流式（本地/自建磁盘）→ 整个文件作为请求体 PUT 给本站，边收边落盘，
 *    上限就是后台配的 attachmentMaxMb（默认 200MB，可调至 2GB+）；
 * 3. 无云盘且驱动不支持流式（s3 / chevereto）→ 回退 `/attachment` 单请求通道（受内存安全线约束）。
 *
 * kind 决定服务端按附件还是音视频校验后缀与云盘开关（后台配置「附件/音视频去向」决定走哪条路）。
 * opts.signal 可取消整轮上传（含退避等待），取消时抛 UploadCancelledError。
 */
export async function uploadAttachment(
  file: File,
  onProgress?: (percent: number) => void,
  kind: UploadKind = "attachment",
  opts?: UploadOptions,
): Promise<AttachmentUploadResult> {
  const signal = opts?.signal;
  try {
    return await runUpload(file, onProgress, kind, signal);
  } catch (e) {
    // fetch 被取消时抛的是英文 DOMException，统一换成可展示的取消错误
    if (signal?.aborted) throw new UploadCancelledError("上传已取消");
    throw e;
  }
}

async function runUpload(
  file: File,
  onProgress: ((percent: number) => void) | undefined,
  kind: UploadKind,
  signal?: AbortSignal,
): Promise<AttachmentUploadResult> {
  if (signal?.aborted) throw new UploadCancelledError("上传已取消");

  const sessionRes = await fetch("/api/upload/attachment/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, mime: file.type, kind }),
    signal,
  });
  const session = (await responseJson(sessionRes)) as UploadSessionResponse;
  if (session.code === "NO_CLOUD") {
    const done = await postLegacyAttachment(file, kind, signal);
    onProgress?.(100);
    return done;
  }
  // 重复上传同一文件：服务端复用已完成的记录，直接返回，跳过整轮上传
  if (session.ok === true && session.deduped === true && session.url) {
    onProgress?.(100);
    return {
      url: session.url,
      name: session.name || file.name,
      size: session.size ?? file.size,
    };
  }
  if (!sessionRes.ok || session.ok !== true)
    throw new Error(session.error || "创建上传会话失败");

  // 通道 2：本站流式直传。服务端会按 Content-Length 再校验一次体积，
  // 所以这里不必自己判上限——超了让服务端给出带真实上限的文案。
  if (session.mode === "driver" && session.uploadUrl) {
    const done = await putRawBody(session.uploadUrl, file, onProgress, signal);
    onProgress?.(100);
    return {
      url: done.url as string,
      name: (done.name as string) || file.name,
      size: (done.size as number) ?? file.size,
    };
  }

  if (!session.ticket || !session.uploadUrl)
    throw new Error(session.error || "创建 OneDrive 上传会话失败");

  await uploadViaGraphSession(session.uploadUrl, session.chunkSize, file, onProgress, signal);

  const completeRes = await fetch("/api/upload/attachment/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: session.ticket }),
    signal,
  });
  const completed = await responseJson(completeRes);
  if (!completeRes.ok || completed.ok !== true)
    throw new Error((completed.error as string) || "确认 OneDrive 上传失败");
  onProgress?.(100);
  return {
    url: completed.url as string,
    name: (completed.name as string) || file.name,
    size: completed.size as number,
  };
}
