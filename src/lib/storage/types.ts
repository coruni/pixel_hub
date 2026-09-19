// 存储驱动接口：key 一律为相对路径（无前导斜杠）或完整 URL（chevereto 模式下落库的就是 URL）。
// 调用方（process.ts / 媒体库删除）只依赖本接口，driver 由 STORAGE_DRIVER 环境变量决定。
export interface StorageDriver {
  name: "local" | "s3" | "chevereto";
  /** 写入并返回公开可访问 URL */
  put(key: string, buf: Buffer): Promise<string>;
  /** 读取（chevereto 远端图不支持按 key 读原字节时抛错即可，当前管线不依赖 get） */
  get(key: string): Promise<Buffer>;
  /** 字节数（同上，尽力而为） */
  size(key: string): Promise<number>;
  /** 删除（尽力而为：远端失败不阻塞调用方） */
  del(key: string): Promise<void>;
  /**
   * 可选：流式写入大文件（不把整个文件读进内存）。
   * 只有本地磁盘能这么写；s3 / chevereto 需要各自的 multipart 实现，暂不提供 ——
   * 调用方必须先问 `streamCapable()`，不要假定所有驱动都有。
   * 返回实际落盘字节数，供调用方写 Media.size。
   */
  putStream?(
    key: string,
    body: ReadableStream<Uint8Array>,
    maxBytes: number,
  ): Promise<{ url: string; size: number }>;
}

export function isUrl(key: string): boolean {
  return /^https?:\/\//i.test(key);
}
