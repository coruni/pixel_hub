"use client";

import { useEffect } from "react";
import { applyColorMode, readColorMode, watchSystemColorMode } from "@/lib/color-mode";

/**
 * 系统配色联动：偏好为 system 时，系统/浏览器切换深浅色要立刻跟上下。
 * 偏好是显式 light/dark 时不做任何事 —— 那是用户的明确选择，不该被 OS 覆盖。
 *
 * 本身不渲染任何东西：首帧的 class 由 app/layout.tsx 的内联脚本设置，这里只接管之后的变化。
 */
export default function ColorModeSync() {
  useEffect(() => {
    const onSystemChange = () => {
      // readColorMode 读的是 <html> 上的当前属性，所以设置页改了偏好、这里无需额外通知
      if (readColorMode() === "system") applyColorMode("system");
    };
    return watchSystemColorMode(onSystemChange);
  }, []);
  return null;
}
