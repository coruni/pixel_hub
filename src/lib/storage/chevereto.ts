// chevereto 图床驱动：上传走 V4 REST API（POST /api/1/upload），key 语义退化为「落库即远端 URL」。
// 配置：后台「站点配置」（旧 env CHEVERETO_BASE / CHEVERETO_API_KEY 回退）。
// 删除为尽力而为：从 URL 解析 image id 调 DELETE /api/1/image/{id}，失败仅记日志（远端可在 chevereto 媒体库自行清理）。
import type { StorageDriver } from "./types";
import { isUrl } from "./types";
import { cheveretoApiKey, cheveretoBase, getRuntimeConfig } from "@/lib/runtime-config";

async function cfg() {
  const c = await getRuntimeConfig();
  return {
    base: cheveretoBase(c).replace(/\/$/, ""),
    apiKey: cheveretoApiKey(c),
  };
}

type CheveretoImage = { url?: string; id?: string };

/** key 由 processImage 生成、必带扩展名；chevereto(PHP) 依赖 multipart 的文件名与类型识别上传 */
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export const cheveretoDriver: StorageDriver = {
  name: "chevereto",
  async put(key, buf) {
    const { base, apiKey } = await cfg();
    if (!base || !apiKey)
      throw new Error("chevereto 存储未配置：请在后台「站点配置」填写站点地址与 API Key");
    const ext = (key.split(".").pop() ?? "").toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
    const form = new FormData();
    // 必须带文件名与 Content-Type：缺 filename 时部分 chevereto 版本报 400
    form.append("source", new Blob([new Uint8Array(buf)], { type: mime }), `image.${ext || "bin"}`);
    form.append("key", apiKey);
    form.append("format", "json");
    const res = await fetch(`${base}/api/1/upload`, { method: "POST", body: form });
    if (!res.ok) {
      // 400 时 chevereto 的 JSON body 里有具体原因，不能只丢个状态码
      const err = await res.json().catch(() => null);
      throw new Error(
        `chevereto 上传失败: HTTP ${res.status}${err?.error?.message ? ` - ${err.error.message}` : ""}`,
      );
    }
    const data = (await res.json()) as {
      status_code?: number;
      image?: CheveretoImage;
      error?: { message?: string };
    };
    const url = data.image?.url;
    if (data.status_code !== 200 || !url) {
      throw new Error(`chevereto 上传失败: ${data.error?.message ?? "未知错误"}`);
    }
    return url;
  },
  async get() {
    // 图床托管图无法按 key 回读原字节；当前管线不依赖 get
    throw new Error("chevereto 驱动不支持读取原始字节");
  },
  async size() {
    throw new Error("chevereto 驱动不支持查询文件大小");
  },
  async del(key) {
    if (!isUrl(key)) return;
    try {
      const { base, apiKey } = await cfg();
      if (!base || !apiKey) return;
      // chevereto 图片 URL 末段（去扩展名）即 image id
      const id = new URL(key).pathname.split("/").filter(Boolean).pop() ?? "";
      const imageId = id.replace(/\.[a-z0-9]+$/i, "");
      if (!imageId) return;
      await fetch(`${base}/api/1/image/${imageId}?key=${encodeURIComponent(apiKey)}`, {
        method: "DELETE",
      });
    } catch (e) {
      console.warn("[storage:chevereto] 远端删除失败（可在图床媒体库手动清理）:", key, e);
    }
  },
};
