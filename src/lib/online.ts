// 在线状态判定：lastSeenAt 在窗口内视为在线。
// 纯函数（客户端心跳间隔共用常量），client 组件可安全 import。
export const ONLINE_WINDOW_MS = 5 * 60 * 1000; // 5 分钟窗口
export const PRESENCE_INTERVAL_MS = 60 * 1000; // 心跳间隔

export function isOnline(lastSeenAt: Date | string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  const t = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  return Date.now() - t.getTime() < ONLINE_WINDOW_MS;
}
