"use client";

// 图片上传客户端：`/api/upload` 的**唯一**调用口（发布向导 /upload 与后台改稿页共用）。
//
// 为什么单独抽一层，而不是在组件里直接 fetch：
//
// 1) 反代（Cloudflare 等）在源站超过 100s 未响应时返回 **524**，且**响应体是空的**。
//    直接 `res.json()` 会抛 `SyntaxError: Unexpected end of JSON input`，把「源站超时」
//    伪装成「JSON 解析失败」——真实原因（状态码）被吞掉，日志里只剩一句无关报错。
//    这里统一「先取文本、再防御式解析」，任何非 JSON 响应都回退到按状态码解释。
//
// 2) 单张图片在服务端要落 **三份对象**（原图 / 大图 / 缩略图，见 lib/media/process.ts），
//    单个请求本身就重。批量上传必须**限制并发**：把十几张图同时打向源站，只会让排在
//    后面的请求熬完反代的超时预算而 524；并发压到 2 反而整体更快、更可预期。
//
// 3) 502/503/504/429 这类瞬时故障值得退避重试；524 不值得（理由见 isRetryable）。

/** 服务端 /api/upload 返回的单个文件结果。字段与组件层 `Uploaded`（wizard-shared）结构一致，
 *  两者是同一份契约的两侧视图，改动时需同步。 */
export type ImageUploadItem = {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
  thumbUrl: string | null;
  bigUrl: string | null;
  origUrl: string | null;
  width?: number | null;
  height?: number | null;
};

export type ImageUploadOutcome = { ok: true; item: ImageUploadItem } | { ok: false; error: string };

/** 批量结果：good 保持与入参同序（首图用作封面，顺序必须稳定） */
export type ImageUploadBatchResult = {
  good: ImageUploadItem[];
  bad: { name: string; error: string }[];
};

/** 单次上传的最大尝试次数（含首次）。图片请求很重，重试不宜多 */
const MAX_ATTEMPTS = 3;
/** 重试基础退避（指数）：1s → 2s */
const RETRY_BASE_MS = 1000;
/** 批量上传并发上限：给源站留余量，别自己把反代的等待预算耗光 */
export const UPLOAD_CONCURRENCY = 2;
/** 单次请求上限：兜住「连接既不成功也不失败」的悬挂态，否则 UI 会永远停在「处理中」 */
const REQUEST_TIMEOUT_MS = 150_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 读响应体：先取文本再解析。空体 / 反代 HTML 错误页一律返回 null，交给状态码解释 */
async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 网关侧失败状态码 → 用户能看懂的原因（服务端没给 error 时的兜底） */
function gatewayError(status: number): string | null {
  switch (status) {
    case 524:
      return "源站处理超时（524）：图片较大或图床响应慢，已超出反代等待上限。请减少单张体积或分批上传";
    case 504:
      return "源站响应超时（504），请稍后重试";
    case 502:
    case 503:
      return `源站暂时不可用（${status}），请稍后重试`;
    case 413:
      return "图片超过服务器允许的体积";
    case 429:
      return "上传过于频繁，请稍后再试";
    default:
      return null;
  }
}

/**
 * 是否值得退避重试。
 * 524 明确排除：它是「同一条请求已经把反代的 100s 预算用完」的确定性结果，
 * 原样重发只会在同一个预算下再超一次，还要把同样的字节再压一遍源站——
 * 重试不但必然失败，还会放大已经饱和的源站负载。改为直接给出可操作提示。
 */
function isRetryable(status: number): boolean {
  if (status === 524) return false;
  return status === 429 || (status >= 500 && status < 600);
}

type Attempt = { ok: true; item: ImageUploadItem } | { ok: false; error: string; retryable: boolean };

/** 单次请求（不发重试）。所有返回分支都带 retryable，供上层决定是否退避 */
async function postOnce(file: File, maxCount: number): Promise<Attempt> {
  const fd = new FormData();
  fd.append("files", file);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/upload?max=${maxCount}`, {
      method: "POST",
      body: fd,
      signal: ctrl.signal,
    });
    // 先判状态码再看体：失败响应的体可能是空 / 反代 HTML，先 res.json() 会抛解析错、掩盖真实状态
    if (!res.ok) {
      const body = await readJson(res);
      const serverError = typeof body?.error === "string" ? body.error : "";
      console.warn(`[upload:client] 上传被拒 fileName=${file.name}`, {
        status: res.status,
        body,
      });
      return {
        ok: false,
        error: serverError || gatewayError(res.status) || `上传失败（HTTP ${res.status}）`,
        retryable: isRetryable(res.status),
      };
    }
    const data = await readJson(res);
    if (!data) {
      // 200 但体不是 JSON：不该发生，单独报出来便于定位（而不是伪装成网络错误）
      return { ok: false, error: "服务端返回了非预期的响应内容", retryable: false };
    }
    const item = (Array.isArray(data.files) ? data.files[0] : undefined) as
      | ImageUploadItem
      | undefined;
    if (data.ok === true && item?.ok) return { ok: true, item };
    console.warn(`[upload:client] 上传被拒 fileName=${file.name}`, { status: res.status, body: data });
    return {
      ok: false,
      error: item?.error ?? (typeof data.error === "string" ? data.error : "上传失败"),
      retryable: false,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        error: `上传超时（超过 ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s 未响应），请稍后重试或减少单张体积`,
        retryable: false,
      };
    }
    console.warn(`[upload:client] 请求失败 fileName=${file.name}`, err);
    return { ok: false, error: "网络错误，请重试", retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/** 上传单张图片：失败时按需退避重试（同名同序的远端对象可能重复，重试以「用户拿到结果」为准） */
export async function uploadImageFile(file: File, maxCount: number): Promise<ImageUploadOutcome> {
  let lastError = "上传失败";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const r = await postOnce(file, maxCount);
    if (r.ok) return { ok: true, item: r.item };
    lastError = r.error;
    if (!r.retryable || attempt === MAX_ATTEMPTS) break;
    console.warn(`[upload:client] 第 ${attempt} 次失败，退避重试 fileName=${file.name}`);
    await wait(RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  return { ok: false, error: lastError };
}

/** 批量上传：并发受限、逐个收集成败；成功项保持与入参同序 */
export async function uploadImageFiles(
  files: File[],
  maxCount: number,
  opts?: { concurrency?: number },
): Promise<ImageUploadBatchResult> {
  const limit = Math.max(1, Math.min(opts?.concurrency ?? UPLOAD_CONCURRENCY, files.length));
  const results: ImageUploadOutcome[] = new Array(files.length);
  // 共享游标 + N 个 worker：单线程下「读游标 → 自增」之间没有 await，不会取到同一个下标
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await uploadImageFile(files[i]!, maxCount);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));

  const good: ImageUploadItem[] = [];
  const bad: { name: string; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.ok) good.push(r.item);
    else bad.push({ name: files[i]!.name, error: r.error });
  });
  return { good, bad };
}
