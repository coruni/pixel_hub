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

/** 批量上传进度（供 UI 显示「第 n / 共 m」与当前阶段） */
export type UploadProgress = {
  /** 已完成（成功或失败）的张数 */
  done: number;
  /** 本次批量的总张数 */
  total: number;
  /** 正在处理的文件下标（0-based），全部完成时为 total */
  index: number;
  /** 正在处理的文件名 */
  name: string;
  /** 当前文件的阶段；UI 目前只读 done/total/name，保留字段供后续细分 */
  phase?: "uploading" | "done";
};

/** 批量结果：good 保持与入参同序（首图用作封面，顺序必须稳定） */
export type ImageUploadBatchResult = {
  good: ImageUploadItem[];
  bad: { name: string; error: string }[];
};

/** 单次上传的最大尝试次数（含首次）。图片请求很重，重试不宜多 */
const MAX_ATTEMPTS = 3;
/** 重试基础退避（指数）：1s → 2s */
const RETRY_BASE_MS = 1000;
/** 批次之间的并发上限：给源站留余量，别自己把反代的等待预算耗光 */
export const UPLOAD_CONCURRENCY = 2;
/**
 * 单个请求携带的张数。
 * 服务端一次能处理整批（`form.getAll("files")` 循环 + 等长数组响应），
 * 但整批太大时单请求耗时线性增长，容易顶到反代的超时预算；
 * 4 张在「请求数」与「单请求时长」之间取平衡，也天然低于后台图集张数上限。
 */
export const BATCH_SIZE = 4;
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

type Attempt =
  | { ok: true; items: ImageUploadItem[] }
  | { ok: false; error: string; retryable: boolean };

/**
 * 单次请求（不发重试）。所有返回分支都带 retryable，供上层决定是否退避。
 *
 * **一次可以带多张**：服务端 `/api/upload` 本来就是 `form.getAll("files")` 循环处理、
 * 回 `{ ok, files: [...] }` 数组（上限取 min(?max, 后台 galleryImageMaxCount)）。
 * 早先客户端逐张 append，拿到数组却只读 `files[0]`，多出来的条目被静默丢弃 ——
 * 这也是「粘了 3 张只出一张」的直接原因。现在按整批发送、按整批解析。
 *
 * 仍然限制并发（见 uploadImageFiles）：这里发的是「一个批次」，批次之间才受并发约束，
 * 避免十几张图各开一条重请求把反代的超时预算耗光。
 */
async function postOnce(
  files: File[],
  maxCount: number,
  onProgress?: (percent: number) => void,
): Promise<Attempt> {
  const fd = new FormData();
  // 诊断：确认进到这里的到底是不是数组。staging 结束后移除。
  const isArr = Array.isArray(files);
  if (!isArr) {
    console.error("[upload:diag] postOnce 收到的不是数组", {
      type: Object.prototype.toString.call(files),
      ctor: (files as unknown as { constructor?: { name?: string } })?.constructor?.name,
      hasLength: typeof (files as unknown as { length?: unknown })?.length,
      isFileList: typeof FileList !== "undefined" && (files as unknown) instanceof FileList,
      iterable: typeof (files as unknown as { [Symbol.iterator]?: unknown })?.[Symbol.iterator],
    });
  }
  for (const f of files) fd.append("files", f);
  const label = files.map((f) => f.name).join("、");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    onProgress?.(10); // 已开始发送：fetch 无法读上传字节进度，用阶段值而非伪造百分比
    const res = await fetch(`/api/upload?max=${maxCount}`, {
      method: "POST",
      body: fd,
      signal: ctrl.signal,
    });
    // 请求已送达，进入服务端处理（落三份对象）阶段
    onProgress?.(60);
    // 先判状态码再看体：失败响应的体可能是空 / 反代 HTML，先 res.json() 会抛解析错、掩盖真实状态
    if (!res.ok) {
      const body = await readJson(res);
      const serverError = typeof body?.error === "string" ? body.error : "";
      console.warn(`[upload:client] 上传被拒 fileName=${label}`, {
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
    const arr = Array.isArray(data.files) ? (data.files as ImageUploadItem[]) : [];
    // 服务端逐个文件回结果，**条数必须与请求张数一致**。
    // 少了说明有文件被静默吞掉 —— 那正是「粘 3 张只出一张」的病灶，必须报出来而不是当成功。
    if (data.ok !== true || arr.length !== files.length) {
      console.warn(`[upload:client] 响应条目数与请求不符 fileName=${label}`, {
        status: res.status,
        sent: files.length,
        got: arr.length,
        body: data,
      });
      return {
        ok: false,
        error:
          arr.length === 0
            ? (typeof data.error === "string" ? data.error : "上传失败")
            : `服务端返回了 ${arr.length} 条结果（发了 ${files.length} 张），请重试`,
        retryable: false,
      };
    }
    onProgress?.(100);
    return { ok: true, items: arr };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        error: `上传超时（超过 ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s 未响应），请稍后重试或减少单张体积`,
        retryable: false,
      };
    }
    console.warn(`[upload:client] 请求失败 fileName=${label}`, err);
    return { ok: false, error: "网络错误，请重试", retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 上传一组图片（一个批次）：失败时按需退避重试。
 * 返回的 items 顺序与入参一致 —— 上层按绝对下标回填，首图才能稳定当封面。
 */
async function uploadImagesOnce(
  files: File[],
  maxCount: number,
): Promise<Attempt> {
  let lastError = "上传失败";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const r = await postOnce(files, maxCount);
    if (r.ok) return r;
    lastError = r.error;
    if (!r.retryable || attempt === MAX_ATTEMPTS) break;
    console.warn(
      `[upload:client] 第 ${attempt} 次失败，退避重试 fileName=${files.map((f) => f.name).join("、")}`,
    );
    await wait(RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  return { ok: false, error: lastError, retryable: false };
}

/** 上传单张图片：失败时按需退避重试（同名同序的远端对象可能重复，重试以「用户拿到结果」为准） */
export async function uploadImageFile(
  file: File,
  maxCount: number,
  onProgress?: (percent: number) => void,
): Promise<ImageUploadOutcome> {
  const r = await postOnce([file], maxCount, onProgress);
  if (r.ok) {
    const item = r.items[0];
    if (item) return { ok: true, item };
    return { ok: false, error: "服务端未返回该文件的结果" };
  }
  if (r.retryable) {
    // 单张入口（后台封面等）仍走退避重试，语义与批量一致
    let lastError = r.error;
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await wait(RETRY_BASE_MS * 2 ** (attempt - 2));
      console.warn(`[upload:client] 第 ${attempt - 1} 次失败，退避重试 fileName=${file.name}`);
      const again = await postOnce([file], maxCount, onProgress);
      if (again.ok) {
        const item = again.items[0];
        return item ? { ok: true, item } : { ok: false, error: "服务端未返回该文件的结果" };
      }
      lastError = again.error;
      if (!again.retryable) break;
    }
    return { ok: false, error: lastError };
  }
  return { ok: false, error: r.error };
}

/**
 * 批量上传：按批切分、批内并发受限；成功项保持与入参同序。
 *
 * 每个请求带 BATCH_SIZE 张（服务端一次就能处理整批并回等长数组），批次之间最多
 * `UPLOAD_CONCURRENCY` 个在飞。这样既不会「一张一个请求」把请求数放大 N 倍，
 * 也不会一次把十几张图打满源站、让后面的请求熬完反代的超时预算。
 *
 * `onProgress` 按「已完成张数」回调。服务端没有字节级进度可读，不编造虚假百分比。
 */
export async function uploadImageFiles(
  files: File[],
  maxCount: number,
  opts?: { concurrency?: number; onProgress?: (p: UploadProgress) => void },
): Promise<ImageUploadBatchResult> {
  const total = files.length;
  let done = 0;
  const emit = (index: number, phase: UploadProgress["phase"]) =>
    opts?.onProgress?.({
      done,
      total,
      index,
      name: files[Math.min(index, total - 1)]?.name ?? "",
      phase,
    });

  // 切成批次：最后一批可能不满 BATCH_SIZE
  const batches: { start: number; files: File[] }[] = [];
  for (let i = 0; i < total; i += BATCH_SIZE) {
    batches.push({ start: i, files: files.slice(i, i + BATCH_SIZE) });
  }

  // 批内结果：按绝对下标回填，保证 good 与入参同序（首图要当封面）
  const results: ImageUploadOutcome[] = new Array(total);
  const limit = Math.max(1, Math.min(opts?.concurrency ?? UPLOAD_CONCURRENCY, batches.length));
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const b = batches[cursor];
      cursor += 1;
      if (!b) continue;
      emit(b.start, "uploading");
      const r = await uploadImagesOnce(b.files, maxCount);
      const last = b.start + b.files.length; // 本批结束后的已完成张数下标
      if (r.ok) {
        // 服务端逐条回结果且顺序与入参一致（见 /api/upload 的 for 循环）
        b.files.forEach((_, k) => {
          const item = r.items[k];
          results[b.start + k] = item ? { ok: true, item } : { ok: false, error: "服务端未返回结果" };
        });
      } else {
        b.files.forEach((_, k) => {
          results[b.start + k] = { ok: false, error: r.error };
        });
      }
      done = last;
      emit(last, done < total ? "uploading" : "done");
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
