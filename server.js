"use strict";

/**
 * 自定义服务器：同一个端口同时承载 Next 请求与实时 WebSocket（站内通知 / 评论 / 在线状态）。
 *
 * 为什么必须自定义服务器：Next.js 的 App Router 只暴露 Web 标准 Request/Response，
 * Route Handler 拿不到原始 socket，无法完成 WebSocket 升级。官方文档给的唯一正路就是
 * 自定义服务器（node_modules/next/dist/docs/01-app/02-guides/custom-server.md）。
 *
 * 与 Next dev 的 HMR 共存：Next 自己也会监听 'upgrade'（HMR 走 /_next/hmr），
 * 它由 NextServer.setupWebSocketHandler 在首个请求时挂到本服务器上，晚于本文件的监听器，
 * 所以本文件先执行；对非 /api/ws 的路径**直接 return、不碰 socket**，HMR 照常工作。
 * 反过来，Next 的 upgradeHandler 对没有匹配路由的路径会主动放行（源码里明确写了
 * "user's custom WS server may be listening on the same path"），因此 /api/ws 不会被它抢走。
 *
 * 直接 `next dev` / `next start` 仍然可用（见 package.json 的 dev:next / start:next）：
 * 此时本文件不参与，实时通道不存在，客户端会自动退回轮询。
 */

const http = require("node:http");
const next = require("next");
const { WebSocketServer } = require("ws");
const { getBus } = require("./server/realtime-bus.js");

/** 实时通道端点：与 src/lib/realtime/protocol.ts 的 REALTIME_PATH 一致 */
const REALTIME_PATH = "/api/ws";
const MAX_PAYLOAD_BYTES = 64 * 1024;
const AUTH_TIMEOUT_MS = 5_000;

// 生产判定：Dockerfile 已设 NODE_ENV=production；本地 npm start 用 --prod 显式声明
// （`NODE_ENV=production node server.js` 在 Windows 上不可移植，故不用那种写法）。
const dev = process.argv.includes("--prod") ? false : process.env.NODE_ENV !== "production";
const port = Number.parseInt(process.env.PORT || "3000", 10);
// 绑定地址：默认全网卡（与 next start 一致，也方便局域网/手机访问）；要收紧就设 HOST=127.0.0.1
const host = process.env.HOST || "0.0.0.0";
// 回环鉴权请求的目标：绑定通配地址时 127.0.0.1 最稳
const loopbackHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

/** prepare() 完成前到达的请求给一个明确的 503，而不是 ECONNRESET */
let handle = (_req, res) => {
  res.statusCode = 503;
  res.end("starting");
};

const server = http.createServer((req, res) => handle(req, res));

// —— keep-alive 空闲超时必须长于前置代理的空闲超时 ——
// Node 默认 keepAliveTimeout 只有 5s。线上通常有反代 / CDN 挡在前面，它们会把到源站的
// 连接留 60s 以上；于是源站会**先**把空闲连接关掉，而代理并不知道，下一个请求依旧往这条
// 已关闭的 socket 上发 —— 客户端收到的是 RST（DevTools 里 `net::ERR_CONNECTION_RESET`）。
// 浏览器不会自动重发，用户看到的就是「首屏图片整批加载失败，手动刷新一次又全好了」
// （刷新时代理已经换了一条新连接）。这里把源站的空闲超时调到比任何常见代理都长，
// 让**代理先关**、源站不先关，从根上消掉这个竞态。
// headersTimeout 必须大于 keepAliveTimeout（Node 的约束），留 1s 余量。
const KEEP_ALIVE_TIMEOUT_MS = 5 * 60_000;
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1000;

// httpServer 显式传入：让 Next 把自己的 upgrade 监听挂到本服务器（HMR 依赖它）
const app = next({ dev, port, httpServer: server });
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

/** 跨站 WebSocket 劫持防护：浏览器发起 WS 握手时必带 Origin，校验其与 Host 同源 */
function sameOriginUpgrade(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 非浏览器客户端（脚本、探针）不带 Origin
  const hostHeader = req.headers.host;
  if (!hostHeader) return false;
  try {
    return new URL(origin).host === hostHeader;
  } catch {
    return false;
  }
}

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  const first = raw ? raw.split(",")[0].trim() : "";
  return first || req.socket.remoteAddress || "-";
}

/**
 * 用客户端 cookie 走一次回环请求解析身份。
 * 复用 NextAuth 的 auth()（/api/realtime/session），避免在纯 JS 里重复实现会话解密，
 * 也避免把 Auth 的 cookie 名称/密钥格式耦合进服务器引导文件。
 * 任何失败都返回 null —— 匿名连接仍可订阅公开的评论房间，只是收不到私有通知。
 */
async function resolveIdentity(req) {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  try {
    const res = await fetch(`http://${loopbackHost}:${port}/api/realtime/session`, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.userId === "string" && data.userId ? { userId: data.userId } : null;
  } catch {
    return null;
  }
}

function onUpgrade(req, socket, head) {
  let pathname;
  try {
    pathname = new URL(req.url, "http://internal").pathname;
  } catch {
    return; // 畸形 URL 交回 Next
  }
  // 非实时通道一律不碰 socket：Next dev 的 HMR 同样走 upgrade，抢占会打断热更新
  if (pathname !== REALTIME_PATH) return;

  if (!sameOriginUpgrade(req)) {
    socket.destroy();
    return;
  }
  const ip = clientIp(req);
  if (!getBus().canAccept(ip)) {
    socket.destroy(); // 单 IP 并发超限：直接拒绝，不给握手机会
    return;
  }
  socket.on("error", () => socket.destroy());

  resolveIdentity(req).then((identity) => {
    if (socket.destroyed) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      getBus().attach(ws, identity, ip);
      ws.send(JSON.stringify({ t: "ready", userId: identity ? identity.userId : null }));
    });
  });
}

app
  .prepare()
  .then(() => {
    handle = app.getRequestHandler();
    // 在 listen 之前挂载：早于 Next 在首个请求时挂上的 HMR 监听器，保证本监听器先跑
    server.on("upgrade", onUpgrade);

    server.on("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        console.error(`[realtime] 端口 ${port} 已被占用，请释放该端口或改用 PORT=3001 npm run dev`);
      } else {
        console.error("[realtime] 服务器错误", err);
      }
      process.exit(1);
    });

    server.listen(port, host, () => {
      const shown = host === "0.0.0.0" || host === "::" ? "localhost" : host;
      const mode = dev ? "development" : "production";
      console.log(`> Pixel Hub ready on http://${shown}:${port} (${mode})`);
      console.log(`> 实时通道 ws://${shown}:${port}${REALTIME_PATH}`);
    });
  })
  .catch((err) => {
    console.error("[realtime] Next 启动失败", err);
    process.exit(1);
  });

// 优雅退出：先告诉客户端「服务端要关了」（客户端据此立刻重连，而不是等超时）
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const ws of wss.clients) {
      try {
        ws.close(1001, "server shutdown");
      } catch {
        /* 已断开 */
      }
    }
    // idle 连接已被上面的 keepAliveTimeout 拉长到 5 分钟，不主动回收的话 close() 每次都要
    // 等满下面那个 3s 兜底；先掐掉空闲连接，close() 才不会卡住活跃中的请求。
    server.closeIdleConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
