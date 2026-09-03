// 本地磁盘驱动（开发/单机默认）：public/uploads 下按 key 读写。
import { mkdir, writeFile, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { StorageDriver } from "./types";

const ROOT = path.join(process.cwd(), "public", "uploads");

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
};
