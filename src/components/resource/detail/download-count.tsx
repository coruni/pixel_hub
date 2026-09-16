"use client";

// 下载次数的客户端共享状态。
//
// 为什么需要它：下载次数是**资源级单值**（incrementDownloadAction 只加 resource.downloadCount），
// 但一次下载动作里有两个显示点——区块头的「已下载 N 次」和按钮内的乐观 +1，
// 而清单一屏可能有十几行按钮。服务端渲染的静态值在点击后不会变，两处就会互相矛盾。
//
// 用 Context 把同一个计数分发给区块头与所有按钮：任意一行被点击，区块头跟着走。
// 不放 DOM 自定义事件——那要手动挂监听与清理，Context 是 React 里这件事的标准解法。

import { createContext, useContext, useState, type ReactNode } from "react";
import { formatCount } from "@/lib/format";

const Ctx = createContext<{ count: number; bump: () => void } | null>(null);

/** 包住一个下载清单区块（section 内层），让区块头与各行按钮共享同一份计数 */
export function DownloadCountScope({ initial, children }: { initial: number; children: ReactNode }) {
  const [count, setCount] = useState(initial);
  return (
    <Ctx.Provider value={{ count, bump: () => setCount((n) => n + 1) }}>{children}</Ctx.Provider>
  );
}

/** 点击下载后调用；不在 scope 内（如详情页其它位置的按钮）则安全空操作 */
export function useDownloadBump() {
  return useContext(Ctx)?.bump;
}

/** 区块头右侧的「已下载 N 次」；不在 scope 内时退化为静态展示 */
export function DownloadCountLabel({ fallback }: { fallback: number }) {
  const ctx = useContext(Ctx);
  return (
    <span className="shrink-0 text-xs text-neutral-400">
      已下载 {formatCount(ctx ? ctx.count : fallback)} 次
    </span>
  );
}
