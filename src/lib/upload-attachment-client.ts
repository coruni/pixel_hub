"use client";

export type AttachmentUploadResult = { url: string; name: string; size: number };

/** 上传去向：附件 / 音频 / 视频。决定服务端的后缀白名单与云盘开关（均由后台配置驱动） */
export type UploadKind = "attachment" | "music" | "video";

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

const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024;
const MAX_RETRIES = 4;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function responseJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

/**
 * 把文件作为「整个请求体」PUT 上去（`/attachment/stream`）。
 *
 * 这里用 XHR 而不是 fetch：fetch 读不到上传进度（`ReadableStream` 请求体在浏览器里
 * 不能可靠地拿到已发送字节数），2GB 的视频若没有进度条，用户只会看到界面卡住。
 * XHR 的 `upload.onprogress` 是唯一现成可用的方案。
 */
function putRawBody(
  url: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0)
        onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        /* 非 JSON 响应按状态码判错 */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.ok === true) resolve(data);
      else reject(new Error((data.error as string) || `文件上传失败（HTTP ${xhr.status}）`));
    };
    xhr.onerror = () => reject(new Error("网络中断，上传未完成，请重试"));
    xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.send(file);
  });
}

async function uploadChunk(
  uploadUrl: string,
  chunk: Blob,
  start: number,
  total: number,
): Promise<void> {
  const end = start + chunk.size - 1;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Type": "application/octet-stream",
      },
      body: chunk,
    });
    if (res.ok || res.status === 202) {
      await res.arrayBuffer().catch(() => {});
      return;
    }
    const detail = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_RETRIES - 1)
      throw new Error(detail || `OneDrive 分片上传失败（HTTP ${res.status}）`);
    await wait(500 * 2 ** attempt);
  }
}

async function postLegacyAttachment(
  file: File,
  kind: UploadKind,
): Promise<AttachmentUploadResult> {
  const fd = new FormData();
  fd.set("file", file);
  if (kind !== "attachment") fd.set("kind", kind);
  const res = await fetch("/api/upload/attachment", { method: "POST", body: fd });
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

/**
 * 大文件上传的调度器。三条通道，由服务端 `/attachment/session` 的回答决定走哪条：
 *
 * 1. 云盘可用 → 浏览器直传 Graph 分片，本站只处理小 JSON 请求；
 * 2. 无云盘但存储层支持流式（本地/自建磁盘）→ 整个文件作为请求体 PUT 给本站，边收边落盘，
 *    上限就是后台配的 attachmentMaxMb（默认 200MB，可调至 2GB+）；
 * 3. 无云盘且驱动不支持流式（s3 / chevereto）→ 回退 `/attachment` 单请求通道（受内存安全线约束）。
 *
 * kind 决定服务端按附件还是音视频校验后缀与云盘开关（后台配置「附件/音视频去向」决定走哪条路）。
 */
export async function uploadAttachment(
  file: File,
  onProgress?: (percent: number) => void,
  kind: UploadKind = "attachment",
): Promise<AttachmentUploadResult> {
  const sessionRes = await fetch("/api/upload/attachment/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, mime: file.type, kind }),
  });
  const session = (await responseJson(sessionRes)) as UploadSessionResponse;
  if (session.code === "NO_CLOUD") return postLegacyAttachment(file, kind);
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
    const done = await putRawBody(session.uploadUrl, file, onProgress);
    onProgress?.(100);
    return {
      url: done.url as string,
      name: (done.name as string) || file.name,
      size: (done.size as number) ?? file.size,
    };
  }

  if (!session.ticket || !session.uploadUrl)
    throw new Error(session.error || "创建 OneDrive 上传会话失败");

  const chunkSize = session.chunkSize || DEFAULT_CHUNK_SIZE;
  for (let start = 0; start < file.size; start += chunkSize) {
    const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
    await uploadChunk(session.uploadUrl, chunk, start, file.size);
    onProgress?.(Math.min(100, Math.round(((start + chunk.size) / file.size) * 100)));
  }

  const completeRes = await fetch("/api/upload/attachment/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: session.ticket }),
  });
  const completed = await responseJson(completeRes);
  if (!completeRes.ok || completed.ok !== true)
    throw new Error((completed.error as string) || "确认 OneDrive 上传失败");
  return {
    url: completed.url as string,
    name: (completed.name as string) || file.name,
    size: completed.size as number,
  };
}
