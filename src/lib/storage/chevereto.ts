// chevereto 图床驱动：上传走 V4 REST API（POST /api/1/upload），key 语义退化为「落库即远端 URL」。
// env: CHEVERETO_BASE（如 https://img.example.com） CHEVERETO_API_KEY
// 删除为尽力而为：从 URL 解析 image id 调 DELETE /api/1/image/{id}，失败仅记日志（远端可在 chevereto 媒体库自行清理）。
import type { StorageDriver } from "./types";
import { isUrl } from "./types";

const base = () => (process.env.CHEVERETO_BASE ?? "").replace(/\/$/, "");
const apiKey = () => process.env.CHEVERETO_API_KEY ?? "";

type CheveretoImage = { url?: string; id?: string };

export const cheveretoDriver: StorageDriver = {
  name: "chevereto",
  async put(_key, buf) {
    if (!base() || !apiKey()) throw new Error("chevereto 存储未配置：缺少 CHEVERETO_BASE / CHEVERETO_API_KEY");
    const form = new FormData();
    form.append("source", new Blob([new Uint8Array(buf)]));
    form.append("key", apiKey());
    form.append("format", "json");
    const res = await fetch(`${base()}/api/1/upload`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`chevereto 上传失败: HTTP ${res.status}`);
    const data = (await res.json()) as { status_code?: number; image?: CheveretoImage; error?: { message?: string } };
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
      // chevereto 图片 URL 末段（去扩展名）即 image id
      const id = new URL(key).pathname.split("/").filter(Boolean).pop() ?? "";
      const imageId = id.replace(/\.[a-z0-9]+$/i, "");
      if (!imageId) return;
      await fetch(`${base()}/api/1/image/${imageId}?key=${encodeURIComponent(apiKey())}`, { method: "DELETE" });
    } catch (e) {
      console.warn("[storage:chevereto] 远端删除失败（可在图床媒体库手动清理）:", key, e);
    }
  },
};
