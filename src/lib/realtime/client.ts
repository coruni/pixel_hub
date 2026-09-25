"use client";

/**
 * 浏览器侧的实时通道客户端（模块级单例，全站共享一条 WebSocket）。
 *
 * 设计取舍：
 * - **信号走 WS，数据走 HTTP**。WS 只负责「有事发生了」的低延迟信号；评论正文、未读数
 *   仍由既有 /api/comments、/api/notifications/unread 提供。这样不必在推送路径上复制
 *   一套查询与序列化逻辑，也让数据只有一个事实来源。
 * - **WS 是增强通道**。连不上（直接 next dev、代理不支持 upgrade、公司网络封 WS）时
 *   所有订阅静默失效，各消费方的低频兜底轮询继续工作，功能不降级。
 * - 连接按需拉起：有订阅者（房间 / 在线关注 / 登录用户的通知通道）才连，全部退订即断开。
 */
import {
  CLIENT_PING_MS,
  CLIENT_PONG_TIMEOUT_MS,
  REALTIME_PATH,
  type ClientMessage,
  type ServerMessage,
} from "./protocol";

type MessageListener = (msg: ServerMessage) => void;

// ---------------- 可订阅状态（useSyncExternalStore 直接消费，不引入状态管理库） ----------------

const store = {
  connected: false,
  /** 未读数；null = 尚无权威值，调用方应沿用服务端渲染的初值 */
  unread: null as number | null,
  /** userId -> 在线状态（只保存 WS 有明确结论的用户） */
  presence: new Map<string, boolean>(),
};

const storeListeners = new Set<() => void>();

function emit(): void {
  for (const listener of storeListeners) listener();
}

export function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

export const connectedSnapshot = (): boolean => store.connected;
export const unreadSnapshot = (): number | null => store.unread;

/** 某用户的实时在线状态；undefined = WS 没有结论，调用方回落到 SSR 值 */
export function presenceOf(userId: string): boolean | undefined {
  return store.presence.get(userId);
}

// ---------------- 连接与订阅状态 ----------------

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pongTimer: ReturnType<typeof setTimeout> | null = null;
let awaitingPong = false;
let attempt = 0;
/** 常驻消费者数（登录用户的通知通道）；>0 时即使没有房间也保持连接 */
let baseConsumers = 0;
/** 房间 -> 引用计数（多个组件可能订阅同一房间） */
const roomRefs = new Map<string, number>();
/** 被关注用户 -> 引用计数 */
const watchRefs = new Map<string, number>();
const messageListeners = new Set<MessageListener>();

function wanted(): boolean {
  return baseConsumers > 0 || roomRefs.size > 0 || watchRefs.size > 0;
}

function send(message: ClientMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // 连接正在关闭：交给 onclose 收尾
  }
}

/**
 * 合并短时间内的订阅变更再发给服务端。
 * 一次页面渲染会挂载几十个头像、每个都关注自己的作者，逐个发 watch 会让服务端
 * 反复重算 watch 集合并回几十份快照（O(n²) 消息量）；合并成一次只发一遍全量列表。
 */
let subscriptionTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSubscriptionSync(): void {
  if (subscriptionTimer !== null) return;
  subscriptionTimer = setTimeout(() => {
    subscriptionTimer = null;
    send({ t: "sub", rooms: [...roomRefs.keys()] });
    send({ t: "watch", users: [...watchRefs.keys()] });
  }, 50);
}

/** 重连后服务端是全新连接，订阅必须整体重放 */
function flushSubscriptions(): void {
  send({ t: "sub", rooms: [...roomRefs.keys()] });
  send({ t: "watch", users: [...watchRefs.keys()] });
}

function open(): void {
  if (socket || typeof window === "undefined") return;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  let ws: WebSocket;
  try {
    ws = new WebSocket(`${scheme}//${window.location.host}${REALTIME_PATH}`);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    attempt = 0;
    store.connected = true;
    startKeepalive();
    emit();
  };

  ws.onmessage = (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(event.data)) as ServerMessage;
    } catch {
      return; // 畸形帧忽略
    }
    handleMessage(msg);
  };

  ws.onclose = () => {
    if (socket !== ws) return; // 已被新连接替换
    socket = null;
    stopKeepalive();
    store.connected = false;
    emit();
    scheduleReconnect();
  };

  ws.onerror = () => {
    // 错误后浏览器必发 close，重连逻辑统一放在 onclose
  };
}

function close(): void {
  stopKeepalive();
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const ws = socket;
  socket = null;
  store.connected = false;
  emit();
  if (ws) {
    try {
      ws.close(1000, "no subscribers");
    } catch {
      /* 已断开 */
    }
  }
}

/** 连接按需启停：调用方增减订阅后同步一次 */
function sync(): void {
  if (wanted()) open();
  else close();
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null || !wanted()) return;
  // 指数退避 + 抖动：服务端重启时避免全站客户端同时重连
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) + Math.random() * 500;
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    open();
  }, delay);
}

function forceReconnect(): void {
  const ws = socket;
  if (!ws) return;
  try {
    ws.close();
  } catch {
    /* 已断开 */
  }
}

function startKeepalive(): void {
  stopKeepalive();
  // 浏览器 WS API 不暴露协议级 ping/pong，只能自己发应用层 ping 判活；
  // 服务端另有协议级 ping 负责判客户端死没死（见 server/realtime-bus.js）。
  pingTimer = setInterval(() => {
    if (awaitingPong) {
      forceReconnect(); // 上一轮没等到 pong：链路已死
      return;
    }
    awaitingPong = true;
    send({ t: "ping" });
    pongTimer = setTimeout(() => {
      if (awaitingPong) forceReconnect();
    }, CLIENT_PONG_TIMEOUT_MS);
  }, CLIENT_PING_MS);
}

function stopKeepalive(): void {
  if (pingTimer !== null) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (pongTimer !== null) {
    clearTimeout(pongTimer);
    pongTimer = null;
  }
  awaitingPong = false;
}

// ---------------- 消息处理 ----------------

function handleMessage(msg: ServerMessage): void {
  switch (msg.t) {
    case "ready":
      flushSubscriptions();
      if (msg.userId) void refreshUnread(); // 重连后立刻校正一次未读数
      break;
    case "pong":
      awaitingPong = false;
      if (pongTimer !== null) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }
      break;
    case "presence":
      store.presence.set(msg.userId, msg.online);
      emit();
      break;
    case "presence:sync":
      for (const entry of msg.entries) store.presence.set(entry.userId, entry.online);
      emit();
      break;
    case "notify:changed":
      scheduleUnreadRefresh();
      break;
    default:
      break; // comment:* 由订阅方自行处理
  }
  for (const listener of messageListeners) listener(msg);
}

export function onMessage(listener: MessageListener): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

// ---------------- 未读数 ----------------

let unreadTimer: ReturnType<typeof setTimeout> | null = null;

/** 合并短时间内的多次通知变化（一条评论可能同时触发评论 + 通知两个事件） */
function scheduleUnreadRefresh(): void {
  if (unreadTimer !== null) return;
  unreadTimer = setTimeout(() => {
    unreadTimer = null;
    void refreshUnread();
  }, 300);
}

/** 拉一次权威未读数。失败静默：沿用上一次的值，等下一次事件或兜底轮询 */
export async function refreshUnread(): Promise<void> {
  try {
    const res = await fetch("/api/notifications/unread", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { unread?: number };
    if (typeof data.unread !== "number" || data.unread === store.unread) return;
    store.unread = data.unread;
    emit();
  } catch {
    /* 网络抖动忽略 */
  }
}

// ---------------- 对外订阅 API ----------------

/** 登录用户常驻实时连接（收通知）。返回退订函数。 */
export function keepRealtimeAlive(): () => void {
  baseConsumers += 1;
  sync();
  return () => {
    baseConsumers = Math.max(0, baseConsumers - 1);
    sync();
  };
}

/** 订阅一个公开房间（资源评论流）。返回退订函数。 */
export function subscribeRoom(room: string): () => void {
  roomRefs.set(room, (roomRefs.get(room) ?? 0) + 1);
  scheduleSubscriptionSync();
  sync();
  return () => {
    const left = (roomRefs.get(room) ?? 1) - 1;
    if (left > 0) roomRefs.set(room, left);
    else roomRefs.delete(room);
    scheduleSubscriptionSync();
    sync();
  };
}

/** 关注一组用户的在线状态。返回退订函数。 */
export function watchUsers(userIds: string[]): () => void {
  for (const id of userIds) watchRefs.set(id, (watchRefs.get(id) ?? 0) + 1);
  scheduleSubscriptionSync();
  sync();
  return () => {
    for (const id of userIds) {
      const left = (watchRefs.get(id) ?? 1) - 1;
      if (left > 0) watchRefs.set(id, left);
      else watchRefs.delete(id);
    }
    scheduleSubscriptionSync();
    sync();
  };
}
