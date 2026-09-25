"use strict";

/**
 * 进程内实时总线：站内通知 / 资源详情页评论 / 在线状态的 WebSocket 分发层。
 *
 * 为什么放在 globalThis 上而不是模块导出：server.js（WebSocket 层）与 Next 运行时
 * （Server Action / Route Handler）跑在同一个 Node 进程里，需要共享同一份连接与房间状态。
 * Next 打包时可能把同一个模块复制进多个 chunk，模块级变量会分叉；globalThis 是进程级的，
 * 无论被复制几次都指向同一份状态，所以这里是唯一可靠的单例载体。
 *
 * 若应用不是经 server.js 启动（例如直接 `next dev` / `next start`），本模块从未被 require，
 * Next 侧的 publish 会静默降级、客户端退回轮询 —— 见 src/lib/realtime/publish.ts。
 *
 * 消息协议见 src/lib/realtime/protocol.ts（那边是唯一带类型的定义处）。
 */

const BUS_KEY = "__pixelhubBus";

// 与 protocol.ts 的常量保持一致
const MAX_ROOMS_PER_CONN = 8;
const MAX_WATCH_PER_CONN = 300;
const MAX_CONNS_PER_IP = 20;
const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** 协议级 ping 间隔；连续漏掉 MAX_MISSED_PINGS 次即判定链路已死 */
const PING_INTERVAL_MS = 30_000;
const MAX_MISSED_PINGS = 2;
/** WebSocket.OPEN */
const WS_OPEN = 1;

/** 房间名白名单：只允许公开的资源评论房间；user:* 由服务端按身份自动加入，不接受客户端订阅 */
function isSubscribableRoom(room) {
  return typeof room === "string" && room.startsWith("resource:") && ID_RE.test(room.slice(9));
}

function sanitizeIds(list, max) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  for (const v of list) {
    if (typeof v === "string" && ID_RE.test(v)) seen.add(v);
    if (seen.size >= max) break;
  }
  return [...seen];
}

function sanitizeRooms(list, max) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  for (const room of list) {
    if (isSubscribableRoom(room)) seen.add(room);
    if (seen.size >= max) break;
  }
  return [...seen];
}

function createBus() {
  /** @type {Map<object, {userId: string|null, ip: string, rooms: Set<string>, watch: Set<string>, missedPings: number, timer: NodeJS.Timeout|null}>} */
  const conns = new Map();
  /** room -> Set<ws> */
  const rooms = new Map();
  /** userId -> Set<ws>（该用户当前的活跃连接） */
  const users = new Map();
  /** 被关注者 userId -> Set<ws>（关注其在线状态的连接） */
  const watchers = new Map();
  /** ip -> 连接数 */
  const ipCount = new Map();

  function indexAdd(index, key, ws) {
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    set.add(ws);
  }

  function indexDelete(index, key, ws) {
    const set = index.get(key);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) index.delete(key);
  }

  function send(ws, message) {
    if (ws.readyState !== WS_OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // 连接正在关闭：交给 close 事件收尾，这里不抛出
    }
  }

  function isUserOnline(userId) {
    const set = users.get(userId);
    return !!set && set.size > 0;
  }

  /** 广播给某个房间里的所有连接 */
  function publishRoom(room, message) {
    const set = rooms.get(room);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify(message);
    for (const ws of set) {
      if (ws.readyState !== WS_OPEN) continue;
      try {
        ws.send(payload);
      } catch {
        /* 同上 */
      }
    }
  }

  /** 广播给某个用户的所有连接（私有通道，不进 rooms 索引也可达） */
  function publishUser(userId, message) {
    if (!userId) return;
    const set = users.get(userId);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify(message);
    for (const ws of set) {
      if (ws.readyState !== WS_OPEN) continue;
      try {
        ws.send(payload);
      } catch {
        /* 同上 */
      }
    }
  }

  /** 某用户上线/下线：只推给正在关注他的人 */
  function publishPresence(userId, online) {
    const set = watchers.get(userId);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify({ t: "presence", userId, online });
    for (const ws of set) {
      if (ws.readyState !== WS_OPEN) continue;
      try {
        ws.send(payload);
      } catch {
        /* 同上 */
      }
    }
  }

  function setRooms(ws, next) {
    const info = conns.get(ws);
    if (!info) return;
    for (const room of info.rooms) if (!next.has(room)) indexDelete(rooms, room, ws);
    for (const room of next) if (!info.rooms.has(room)) indexAdd(rooms, room, ws);
    info.rooms = next;
  }

  function setWatch(ws, next) {
    const info = conns.get(ws);
    if (!info) return;
    for (const id of info.watch) if (!next.has(id)) indexDelete(watchers, id, ws);
    for (const id of next) if (!info.watch.has(id)) indexAdd(watchers, id, ws);
    info.watch = next;
    // 立即回快照：客户端不必等下一次状态变化才知道谁在线
    const entries = [];
    for (const id of next) {
      entries.push({ userId: id, online: isUserOnline(id) });
    }
    if (entries.length > 0) send(ws, { t: "presence:sync", entries });
  }

  function handleMessage(ws, raw) {
    const info = conns.get(ws);
    if (!info) return;
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_CLIENT_MESSAGE_BYTES) {
      try {
        ws.close(1009, "message too large");
      } catch {
        /* 已断开 */
      }
      return;
    }
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return; // 畸形 JSON 直接忽略，不因此断连
    }
    if (!msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "ping":
        send(ws, { t: "pong" });
        break;
      case "sub":
        setRooms(ws, new Set(sanitizeRooms(msg.rooms, MAX_ROOMS_PER_CONN)));
        break;
      case "watch":
        setWatch(ws, new Set(sanitizeIds(msg.users, MAX_WATCH_PER_CONN)));
        break;
      default:
        break; // 未知消息类型忽略（协议向前兼容）
    }
  }

  /** 连接是否还能接纳（单 IP 并发上限） */
  function canAccept(ip) {
    return (ipCount.get(ip) ?? 0) < MAX_CONNS_PER_IP;
  }

  /**
   * 绑定一条已完成握手的连接。
   * @param ws 已升级的 WebSocket
   * @param {{userId: string} | null} identity 匿名连接传 null
   * @param {string} ip 用于并发限流
   */
  function attach(ws, identity, ip) {
    const userId = identity && typeof identity.userId === "string" ? identity.userId : null;
    const info = {
      userId,
      ip: ip || "-",
      rooms: new Set(),
      watch: new Set(),
      missedPings: 0,
      timer: null,
    };
    conns.set(ws, info);
    ipCount.set(info.ip, (ipCount.get(info.ip) ?? 0) + 1);

    if (userId) {
      // 该用户此前是否有别的活跃连接 —— 决定这次是不是「上线」事件
      const wasOnline = isUserOnline(userId);
      indexAdd(users, userId, ws);
      // 私有通道按身份自动加入 users 索引；客户端无需（也不能）显式 sub。
      // 通知通过 publishUser 直达 users 索引，不放进公开 rooms，避免客户端 sub 覆盖时
      // 把私有房间从连接的 rooms 集合里删掉后遗留孤儿索引。
      if (!wasOnline) publishPresence(userId, true);
    }

    ws.on("message", (raw) => handleMessage(ws, raw));
    ws.on("pong", () => {
      info.missedPings = 0;
    });
    ws.on("error", () => {
      /* socket 错误由 close 事件统一收尾；不监听会变成未捕获异常 */
    });
    ws.on("close", () => detach(ws));

    // 协议级保活：浏览器会自动回 pong，不需要客户端写任何保活代码
    info.timer = setInterval(() => {
      if (info.missedPings >= MAX_MISSED_PINGS) {
        try {
          ws.terminate();
        } catch {
          /* 已断开 */
        }
        return;
      }
      info.missedPings += 1;
      try {
        ws.ping();
      } catch {
        /* 已断开 */
      }
    }, PING_INTERVAL_MS);
    if (typeof info.timer.unref === "function") info.timer.unref();
  }

  function detach(ws) {
    const info = conns.get(ws);
    if (!info) return;
    conns.delete(ws);
    if (info.timer) clearInterval(info.timer);
    const left = (ipCount.get(info.ip) ?? 1) - 1;
    if (left > 0) ipCount.set(info.ip, left);
    else ipCount.delete(info.ip);
    for (const room of info.rooms) indexDelete(rooms, room, ws);
    for (const id of info.watch) indexDelete(watchers, id, ws);
    if (info.userId) {
      indexDelete(users, info.userId, ws);
      // 最后一个连接关闭才算下线（多标签页/多设备只发一次）
      if (!isUserOnline(info.userId)) publishPresence(info.userId, false);
    }
  }

  return {
    attach,
    detach,
    canAccept,
    publishRoom,
    publishUser,
    publishPresence,
    isUserOnline,
    /** 观测用：连接数与房间数 */
    stats: () => ({ conns: conns.size, rooms: rooms.size, onlineUsers: users.size }),
  };
}

/** 取（必要时创建）进程内总线单例 */
function getBus() {
  if (!globalThis[BUS_KEY]) globalThis[BUS_KEY] = createBus();
  return globalThis[BUS_KEY];
}

module.exports = { getBus, BUS_KEY, MAX_CONNS_PER_IP };
