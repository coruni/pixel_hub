// 存储统一入口：按运行配置 storageDriver（local|s3|chevereto，默认 local）分发。
// 驱动选择每次操作动态读取（后台「站点配置」或旧 env STORAGE_DRIVER），切换立即生效、无需重启。
// 兼容旧 API（saveFile/loadFile/fileSize/publicUrl/makeKey/absKey），新增 del()。
// 约定：local/s3 落库的是相对 key；chevereto 落库的是远端完整 URL（publicUrl 对 URL 原样返回）。
// publicUrl 的纯函数实现放 ./url（无 node 依赖，client 组件经它间接可用时不会被拖入 node:fs）。
import { randomUUID } from "node:crypto";
import { localDriver, absKey } from "./local";
import { s3Driver } from "./s3";
import { cheveretoDriver } from "./chevereto";
import type { StorageDriver } from "./types";
import { getRuntimeConfig } from "@/lib/runtime-config";

export type { StorageDriver };
export { absKey };
export { publicUrl, isUrl as isStorageUrl } from "./url";

async function getDriver(): Promise<StorageDriver> {
  const c = await getRuntimeConfig();
  return c.storageDriver === "s3"
    ? s3Driver
    : c.storageDriver === "chevereto"
      ? cheveretoDriver
      : localDriver;
}

export function makeKey(dir: string, ext: string): string {
  const d = new Date();
  const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${dir}/${yyyymm}/${randomUUID()}${ext}`;
}

/** 写入并返回公开 URL（chevereto 返回远端 URL，其余返回本地/CDN 路径） */
export async function saveFile(key: string, buf: Buffer): Promise<string> {
  return (await getDriver()).put(key, buf);
}

export async function loadFile(key: string): Promise<Buffer> {
  return (await getDriver()).get(key);
}

export async function fileSize(key: string): Promise<number> {
  return (await getDriver()).size(key);
}

export async function delFile(key: string): Promise<void> {
  return (await getDriver()).del(key);
}
