"use client";

import { useCallback, type ClipboardEvent as ReactClipboardEvent } from "react";

/** 只用到 clipboardData，用结构化入参避免与全局 ClipboardEvent 混淆 */
type ClipboardEvent<T> = Pick<ReactClipboardEvent<T>, "clipboardData" | "preventDefault">;

/** 从剪贴板事件里取出「图片」文件，按剪贴板顺序排列 */
function imageFilesFrom(e: ClipboardEvent<HTMLElement>): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const out: File[] = [];
  // 必须同步读完 items：事件回调返回后 DataTransferItemList 会被清空，
  // 任何 await 之后再去读都会拿到空列表。
  for (const it of Array.from(items)) {
    if (it.kind !== "file" || !it.type.startsWith("image/")) continue;
    const f = it.getAsFile();
    if (f) out.push(f);
  }
  return out;
}

/**
 * 「Ctrl+V 直接上传剪贴板里的图片」的通用 hook：返回可直接展开到容器的 props
 * （`<div {...pasteProps} />`）。
 *
 * 三处必须踩对的细节：
 * 1. 判据是 `kind === "file" && type.startsWith("image/")`。剪贴板里同时躺着
 *    text/html 与 image/png 时（从网页复制一张图、或从 Word 复制图文），
 *    只有按 file+image 过滤才不会把 HTML 里的盗链 <img> 当成上传项。
 * 2. **没有图片时不 preventDefault**：否则粘贴纯文字会被吞掉，用户在正文里
 *    粘一句话反而什么都粘贴不进去。只在确实要上传时才接管这次粘贴。
 * 3. 剪贴板截图没有文件名（Chrome 下通常是空的 `image.png`），逐个补
 *    `粘贴图片-N.png`，否则上传失败提示里全是无名条目、用户对不上是哪张。
 *
 * disabled 为 true（上传中 / 已达上限）时不接管，交给浏览器默认行为。
 */
export function useFilePaste({
  onFiles,
  disabled = false,
  enabled = true,
}: {
  /** 粘贴到的图片；与 <input type="file"> 的 FileList 同型，便于两条入口共用一条上传链路 */
  onFiles: (files: FileList) => void;
  disabled?: boolean;
  /** 关掉监听（例如单张封面的资源已经有图了，再粘只会被静默丢弃） */
  enabled?: boolean;
}) {
  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLElement>) => {
      if (!enabled || disabled) return;
      const files = imageFilesFrom(e);
      if (files.length === 0) return; // 粘的是文字/链接：不接管，放行默认行为
      e.preventDefault(); // 有图片才算「上传」，此时才吞掉这次粘贴

      const named = files.map((f, i) =>
        f.name ? f : new File([f], `粘贴图片-${i + 1}.png`, { type: f.type }),
      );

      // 调用方只认 FileList（与 input 同型）。这里用「以真 FileList.prototype 为原型、
      // 补上数字索引与 length」的数组式对象来满足它：
      // 不用 new DataTransfer() —— 它在 Safari 14 及更早版上不存在，会直接抛
      // ReferenceError 把整次粘贴打挂；jsdom 也没实现。FileList 是只读的类数组契约，
      // 消费方只读 length / [i] / 迭代，这个替身在语义上完全等价。
      const fl = Object.create(FileList.prototype) as FileList;
      named.forEach((f, i) => {
        Object.defineProperty(fl, i, { value: f, enumerable: true });
      });
      Object.defineProperty(fl, "length", { value: named.length });
      onFiles(fl);
    },
    [disabled, enabled, onFiles],
  );

  return { pasteProps: { onPaste } };
}
