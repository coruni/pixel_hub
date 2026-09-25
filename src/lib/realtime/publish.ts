// Next 运行时的实时发布入口。
//
// 事件总线由 server.js 创建在 globalThis 上（见 server/realtime-bus.js），
// 这里只读不建：应用若未经 server.js 启动（直接 next dev / next start），总线不存在，
// 所有发布静默丢弃，客户端自动退回轮询 —— 实时是增强通道，绝不能成为主流程的依赖。
import { after } from "next/server";
import { roomResource, type ServerMessage } from "./protocol";

type RealtimeBus = {
  publishRoom(room: string, message: ServerMessage): void;
  publishUser(userId: string, message: ServerMessage): void;
  isUserOnline(userId: string): boolean;
};

const BUS_KEY = "__pixelhubBus";

function bus(): RealtimeBus | null {
  const candidate = (globalThis as Record<string, unknown>)[BUS_KEY];
  if (!candidate || typeof (candidate as RealtimeBus).publishRoom !== "function") return null;
  return candidate as RealtimeBus;
}

/** 实时通道当前是否可用（用于日志与降级判断，不影响业务分支） */
export function realtimeEnabled(): boolean {
  return bus() !== null;
}

/** 包一层：实时是副通道，任何异常都不能影响调用方的主流程 */
function safe(fn: (b: RealtimeBus) => void): void {
  try {
    const b = bus();
    if (b) fn(b);
  } catch (e) {
    console.error("[realtime] publish failed", e);
  }
}

/**
 * 把一次发布推迟到响应之后。
 *
 * 用于可能在**事务内**触发的发布点（例如「下架 + 通知」同事务）：立即广播会让收件人
 * 在数据提交前就去查未读数，读到旧值。after() 在响应发出后执行，此时事务必然已结束。
 * 不在请求上下文（cron / seed / 脚本）时 after() 会抛错，直接跳过 —— 那种场景本来也没有在线客户端。
 */
function afterResponse(task: () => void): void {
  try {
    after(task);
  } catch {
    /* 非请求上下文：无客户端可推送，跳过 */
  }
}

/** 资源详情页有新评论：只发信号，正文由客户端拉 /api/comments 增量补齐 */
export function publishCommentNew(resourceId: string): void {
  safe((b) => b.publishRoom(roomResource(resourceId), { t: "comment:new", resourceId }));
}

/** 资源详情页的评论结构变了（删除 / 审核下架）：客户端做一次全量刷新兜底 */
export function publishCommentChanged(resourceId: string): void {
  safe((b) => b.publishRoom(roomResource(resourceId), { t: "comment:changed", resourceId }));
}

/** 某人的通知有变化（新增 / 已读 / 删除 / 清空）：推给其私有通道，客户端重取未读数 */
export function publishNotificationChanged(userId: string): void {
  afterResponse(() => safe((b) => b.publishUser(userId, { t: "notify:changed" })));
}
