"use client";

export type AttachmentUploadResult = { url: string; name: string; size: number };

type UploadSessionResponse = {
  ok: boolean;
  code?: string;
  error?: string;
  ticket?: string;
  uploadUrl?: string;
  chunkSize?: number;
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

async function postLegacyAttachment(file: File): Promise<AttachmentUploadResult> {
  const fd = new FormData();
  fd.set("file", file);
  const res = await fetch("/api/upload/attachment", { method: "POST", body: fd });
  const data = await responseJson(res);
  if (!res.ok || data.ok !== true) throw new Error((data.error as string) || "附件上传失败");
  return {
    url: data.url as string,
    name: (data.name as string) || file.name,
    size: data.size as number,
  };
}

/**
 * OneDrive 启用时浏览器直传 Graph，Vercel 只处理小 JSON 请求。
 * 没有活跃云盘时回退现有存储 API，保持本地/S3/Chevereto 行为不变。
 */
export async function uploadAttachment(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<AttachmentUploadResult> {
  const sessionRes = await fetch("/api/upload/attachment/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, mime: file.type }),
  });
  const session = (await responseJson(sessionRes)) as UploadSessionResponse;
  if (session.code === "NO_CLOUD") return postLegacyAttachment(file);
  // 重复上传同一文件：服务端复用已完成的记录，直接返回，跳过整轮上传
  if (session.ok === true && session.deduped === true && session.url) {
    onProgress?.(100);
    return {
      url: session.url,
      name: session.name || file.name,
      size: session.size ?? file.size,
    };
  }
  if (!sessionRes.ok || session.ok !== true || !session.ticket || !session.uploadUrl)
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
