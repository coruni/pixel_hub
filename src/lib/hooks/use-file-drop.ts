"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";

/** 这次拖拽携带的是不是「文件」（而非网页上的文字、链接或站内图片） */
function carriesFiles(e: DragEvent<HTMLElement>): boolean {
  // dragover 期间浏览器出于安全不暴露 dataTransfer.files，只有 types 可读，故判据取 types
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/**
 * 「把文件拖到这块区域即可上传」的通用 hook：返回 dragging 状态与可直接展开到
 * 投放容器上的 props（`<div {...dropProps} />`）。
 *
 * 三处必须踩对的细节：
 * 1. dragenter/dragleave 会在子元素之间来回冒泡——光标每越过一层子节点就会先 leave
 *    再 enter，用布尔量控制高亮会在光标移入内部元素时闪断。改用「进入/离开」计数器，
 *    归零才算真正离开容器。
 * 2. 拖拽网页上的文字、链接或站内图片时 dataTransfer 里没有文件；若照样高亮，就会
 *    「拖一段文字，整块上传区亮起来」。所以只有 types 含 "Files" 才进入拖拽态。
 * 3. dragover 与 drop 都必须 preventDefault：不拦 dragover 浏览器不认这是投放目标
 *    （既不给可投放光标，drop 也不触发）；不拦 drop 则浏览器会接管这次拖拽，直接
 *    打开被拖的本地文件把页面顶掉。
 *
 * disabled 为 true（上传中 / 已达上限）时不响应、不高亮，语义与 input 的 disabled 对齐。
 */
export function useFileDrop({
  onFiles,
  disabled = false,
}: {
  /** 掉落的文件；与 <input type="file"> 的 FileList 同型，便于两条入口共用一条上传链路 */
  onFiles: (files: FileList) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  // 进入/离开计数器：> 0 表示光标仍在容器（含其子元素）内部
  const depth = useRef(0);

  const clear = useCallback(() => {
    depth.current = 0;
    setDragging(false);
  }, []);

  const onDragEnter = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (disabled || !carriesFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (disabled || !carriesFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy"; // 光标呈现「复制到此」而非移动
    },
    [disabled],
  );

  // 不按 disabled / carriesFiles 提前返回：计数器只增不减会留下「卡住的高亮」
  const onDragLeave = useCallback(() => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      // 无论接不接受都要吞掉这次拖拽：否则浏览器会接管，直接打开被拖的本地文件、
      // 把用户填了一半的表单顶掉。所以 preventDefault 必须排在 disabled 判断之前。
      e.preventDefault();
      clear();
      if (disabled) return; // 上传中 / 已达上限：不接收文件，但上面那一下仍然生效
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return; // 拖的不是文件（文字/链接）
      onFiles(files);
    },
    [disabled, clear, onFiles],
  );

  return { dragging, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
