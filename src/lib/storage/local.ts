// 本地磁盘驱动（开发/单机默认）：public/uploads 下按 key 读写。
import { mkdir, writeFile, readFile, stat, unlink, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import type { StorageDriver } from "./types";

const ROOT = path.join(process.cwd(), "public", "uploads");

/**
 * 流式上传的半成品落这里——**故意不在 `public/` 下**。
 * 先写临时文件、全部成功后 rename 到最终路径：`rename` 在同盘内是原子的，
 * 所以最终 URL 要么不存在、要么是完整文件，永远不会让「传到一半的视频」对外可达
 * （临时文件放在 os.tmpdir() 则可能跨盘，rename 会 EXDEV 失败）。
 */
const TMP_ROOT = path.join(process.cwd(), ".uploads-tmp");

// 库中/调用方可能传：相对 key（files/…）、旧格式（/files/…）或完整站内 URL（/uploads/files/…），
// 读写删前统一归一成相对 key。
export function normKey(key: string): string {
  const k = key.replace(/\\/g, "/").replace(/^\/+/, "");
  return k.startsWith("uploads/") ? k.slice("uploads/".length) : k;
}

export function absKey(key: string): string {
  const root = path.resolve(ROOT);
  const abs = path.resolve(ROOT, normKey(key));
  // 逐段比较（path.sep 兜底根目录）：普通 startsWith 会放过 "uploads-evil" 这类同前缀兄弟目录
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error("非法存储键: 越界路径");
  return abs;
}

export const localDriver: StorageDriver = {
  name: "local",
  async put(key, buf) {
    const abs = absKey(key);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, buf);
    // 返回可直接访问的站内 URL（publicUrl 对此幂等）
    return "/uploads/" + normKey(key);
  },
  async get(key) {
    return readFile(absKey(key));
  },
  async size(key) {
    const s = await stat(absKey(key));
    return s.size;
  },
  async del(key) {
    // 文件可能已被清理，删除容错
    await unlink(absKey(key)).catch(() => {});
  },
  /**
   * 流式落盘：请求体直接进磁盘，内存里只过 chunk 大小的缓冲。
   * 先写临时文件，全部成功才 rename 到最终路径 —— 否则中断会留下一个
   * 字节数不足、却已经能通过公开 URL 访问的「半截文件」（音视频尤其明显）。
   * maxBytes 在流里按累计字节数硬拦，超限立即抛错并删掉临时文件。
   */
  async putStream(key, body, maxBytes) {
    const abs = absKey(key);
    await mkdir(path.dirname(abs), { recursive: true });
    await mkdir(TMP_ROOT, { recursive: true });
    // key 里的文件名本身就是 randomUUID，并发上传不会撞名
    const tmp = path.join(TMP_ROOT, path.basename(abs));
    let size = 0;
    try {
      await pipeline(
        Readable.fromWeb(body as unknown as import("node:stream/web").ReadableStream),
        async function* (src: AsyncIterable<Buffer>) {
          for await (const chunk of src) {
            size += chunk.length;
            // Content-Length 可伪造/缺失，这里才是真正的闸门
            if (size > maxBytes) throw new Error("文件超过允许的上限");
            yield chunk;
          }
        },
        createWriteStream(tmp),
      );
      await rename(tmp, abs);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    return { url: "/uploads/" + normKey(key), size };
  },
};
