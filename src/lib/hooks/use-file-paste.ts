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
 * 把 File[] 包成与 `<input type="file">` 同型的 FileList，让粘贴与文件选择共用一条上传链路。
 *
 * **必须显式挂 `@@iterator`，否则多张只能传出去一张。** 宿主 FileList 只有 `length` 与数字索引，
 * 自身**没有** `Symbol.iterator`（浏览器的 `Symbol.iterator in FileList.prototype === false`）。
 * `Array.from(fl)` / `[...fl]` 走的是「先查 @@iterator，缺失才回退数组式」的取值顺序；
 * 而 `Object.create(FileList.prototype)` 出来的替身既不继承迭代器、又不是真数组，
 * 于是 `Array.from` 只探到 `length === 0`，**无论粘了几张都返回长度 1 的 `[undefined]`**
 * （`fl[0]` 落在原型的索引访问器上，仍是 undefined）。消费方 `Array.from(fl).slice(...)`
 * 正好把这个 `[undefined]` 放行，上游 `!fl.length` 也拦不住 —— 一路静默腐烂到
 * FormData.append 抛 TypeError，表现为「粘贴上传只能出一张」。
 *
 * 不用 `new DataTransfer()`：Safari 14 及更早版本没有它，会直接抛 ReferenceError 把整次粘贴打挂。
 */
function asFileList(files: readonly File[]): FileList {
  const fl = Object.create(FileList.prototype) as FileList;
  files.forEach((f, i) => {
    Object.defineProperty(fl, i, { value: f, enumerable: true });
  });
  Object.defineProperty(fl, "length", { value: files.length });
  Object.defineProperty(fl, Symbol.iterator, {
    value: function* () {
      for (let i = 0; i < this.length; i += 1) yield this[i];
    },
    configurable: true,
  });
  return fl;
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
      onFiles(asFileList(named));
    },
    [disabled, enabled, onFiles],
  );

  return { pasteProps: { onPaste } };
}
