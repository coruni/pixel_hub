// 实时通道协议：浏览器客户端、Next 运行时（Server Action / Route Handler）与
// WebSocket 层（server/realtime-bus.js）三方共享的线上契约。
//
// server.js / server/realtime-bus.js 是纯 JS、不经过 Next 编译器，只重复房间前缀与消息名，
// 不重复这里的类型与上限；改协议时两边一起改（那边有同名的常量块）。

/** WebSocket 端点路径（同源、同端口，见 server.js 的 upgrade 处理） */
export const REALTIME_PATH = "/api/ws";

/**
 * 房间：资源详情页的评论流。
 * 只承载「有新评论 / 评论有变化」这类信号，评论正文仍由 /api/comments 提供 ——
 * 信号走 WS 求低延迟，数据走既有 HTTP 端点求单一事实来源。
 */
export const roomResource = (resourceId: string) => `resource:${resourceId}`;

/**
 * 房间：某个用户的私有通道（通知）。
 * 客户端不能自行订阅 user:* 房间（服务端只按鉴权身份自动加入），否则能偷看别人的通知。
 */
export const roomUser = (userId: string) => `user:${userId}`;

/** 单连接可订阅的房间上限：资源页只需 1 个，留出余量 */
export const MAX_ROOMS_PER_CONN = 8;
/** 单连接可关注的用户上限（在线状态）：够覆盖一整屏评论作者 */
export const MAX_WATCH_PER_CONN = 300;
/** 单条客户端消息上限（字节）：订阅/watch 列表都很小，超出视为异常 */
export const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;
/** 单 IP 并发连接上限 */
export const MAX_CONNS_PER_IP = 20;
/** 客户端保活间隔；服务端用协议级 ping 判活，见 realtime-bus.js */
export const CLIENT_PING_MS = 30_000;
/** 客户端等待 pong 的超时：超时即认为链路已死，主动重连 */
export const CLIENT_PONG_TIMEOUT_MS = 10_000;

/** 房间名 / 用户 id 的形状校验：挡住畸形输入进索引，也避免内存被长字符串撑大 */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type ClientMessage =
  /** 覆盖式订阅公开房间（全量列表，不是增量） */
  | { t: "sub"; rooms: string[] }
  /** 覆盖式设置「关注谁的在线状态」（全量列表） */
  | { t: "watch"; users: string[] }
  /** 应用层保活：服务端回 pong；协议级 ping 由 ws 库负责 */
  | { t: "ping" };

export type PresenceEntry = { userId: string; online: boolean };

export type ServerMessage =
  /** 握手完成。userId 为 null 表示匿名连接（未登录 / 会话解析失败），仍可看公开评论 */
  | { t: "ready"; userId: string | null }
  | { t: "pong" }
  /** 指定资源有新评论 → 客户端立刻拉一次增量 */
  | { t: "comment:new"; resourceId: string }
  /** 指定资源的评论结构变了（删除/审核）→ 客户端全量刷新兜底 */
  | { t: "comment:changed"; resourceId: string }
  /** 自己的通知有变化（新增/已读/删除）→ 客户端重新取未读数 */
  | { t: "notify:changed" }
  /** 某个用户的在线状态发生变化 */
  | { t: "presence"; userId: string; online: boolean }
  /** 对 watch 的即时快照，省去等下一次状态变化 */
  | { t: "presence:sync"; entries: PresenceEntry[] };

/** 客户端可订阅的房间名（白名单前缀 + 形状校验） */
export function isSubscribableRoom(room: string): boolean {
  if (typeof room !== "string" || !room.startsWith("resource:")) return false;
  return ID_RE.test(room.slice("resource:".length));
}
