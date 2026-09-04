"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 悬停延迟开关：进入时延迟 delay 毫秒才置 open（hover 卡片防误触），
 * 离开立即关闭；重复进出会重置计时器。卸载时清理定时器。
 */
export function useHoverDelay(delay = 300) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const openDelayed = useCallback(() => {
    clear();
    timerRef.current = setTimeout(() => setOpen(true), delay);
  }, [clear, delay]);

  const close = useCallback(() => {
    clear();
    setOpen(false);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { open, setOpen, openDelayed, close };
}
