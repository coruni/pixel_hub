// StorageService：本地磁盘实现（开发/单机）。
// 生产切换对象存储(S3/R2)时替换本文件的 saveFile 等实现，调用方无感知。
// key 一律为相对路径（无前导斜杠），数据库只存 key，URL 由 publicUrl 生成。
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), "public", "uploads");

export function absKey(key: string): string {
  const abs = path.resolve(ROOT, key);
  if (!abs.startsWith(path.resolve(ROOT))) throw new Error("非法存储键: 越界路径");
  return abs;
}

/** key → 可直接用于 <img src> 的公开 URL */
export function publicUrl(key: string): string {
  return "/" + key.replace(/\\/g, "/");
}

export function makeKey(dir: string, ext: string): string {
  const d = new Date();
  const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${dir}/${yyyymm}/${randomUUID()}${ext}`;
}

export async function saveFile(key: string, buf: Buffer): Promise<void> {
  const abs = absKey(key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);
}

export async function loadFile(key: string): Promise<Buffer> {
  return readFile(absKey(key));
}

export async function fileSize(key: string): Promise<number> {
  const s = await stat(absKey(key));
  return s.size;
}
