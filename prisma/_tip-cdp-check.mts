// 临时验证：个人主页「打赏作者」端到端（真实浏览器点击 → toast → 库里落账），用完即删
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { encode } from "@auth/core/jwt";

const ROOT = "E:/project/pixel_hub";
const BASE = "http://localhost:3000";
const prisma = new PrismaClient();
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

function loadEnv() {
  const file = `${ROOT}/.env`;
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1]! in process.env)) process.env[m[1]!] = v;
  }
}

async function waitFor(fn, want, timeoutMs, stepMs = 300) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (want(last)) return last;
    } catch {
      /* 导航中瞬态错误忽略 */
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return last;
}

class Cdp {
  #ws;
  #id = 0;
  #waiters = new Map();
  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.#waiters.has(msg.id)) {
        const r = this.#waiters.get(msg.id);
        this.#waiters.delete(msg.id);
        r(msg);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("ws 失败")), { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((res) => {
      this.#waiters.set(id, res);
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error(`evaluate: ${ex.exception?.description ?? ex.text}`);
    return r.result?.result?.value;
  }
  close() {
    try {
      this.#ws.close();
    } catch {}
  }
}

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));

async function launch({ cookie, path, port = 9333 }) {
  const dir = mkdtempSync(join(tmpdir(), "cdp-tip-"));
  const proc = spawn(
    EDGE,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}`,
      "--no-proxy-server",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const dispose = async () => {
    try {
      if (!proc.killed) proc.kill();
    } catch {}
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  };
  const v = await waitFor(
    async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).json(),
    (x) => !!x?.webSocketDebuggerUrl,
    15000,
  );
  if (!v?.webSocketDebuggerUrl) throw new Error("调试端口未就绪");
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  const set = await cdp.send("Network.setCookie", {
    name: "authjs.session-token",
    value: cookie,
    url: BASE,
    path: "/",
    httpOnly: true,
  });
  if (!set?.result?.success) throw new Error("cookie 写入失败");
  await cdp.send("Page.navigate", { url: BASE + path });
  return { cdp, dispose };
}

const balanceOf = async (userId) =>
  (await prisma.coinAccount.findUnique({ where: { userId }, select: { balance: true } }))?.balance ?? 0;

async function main() {
  loadEnv();
  // 观赏者：有余额、非作者、非封禁
  const accounts = await prisma.coinAccount.findMany({
    where: { balance: { gte: 50 } },
    orderBy: { balance: "desc" },
    take: 5,
    select: { userId: true, balance: true, user: { select: { id: true, username: true, role: true, bannedAt: true } } },
  });
  const viewerRow = accounts.find((a) => !a.user.bannedAt);
  if (!viewerRow) throw new Error("找不到有余额的用户");
  const viewer = viewerRow.user;
  const target = await prisma.user.findFirst({
    where: { id: { not: viewer.id }, bannedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true },
  });
  if (!target) throw new Error("找不到打赏对象");

  const before = {
    from: await balanceOf(viewer.id),
    to: await balanceOf(target.id),
    tips: await prisma.tipRecord.count({ where: { fromUserId: viewer.id, resourceId: null } }),
  };
  console.log(`viewer=${viewer.username} 余额 ${before.from} → 打赏 @${target.username}（当前 ${before.to}）\n`);

  const cookie = await encode({
    token: { id: viewer.id, username: viewer.username, role: viewer.role },
    secret: process.env.AUTH_SECRET,
    salt: "authjs.session-token",
  });

  const { cdp, dispose } = await launch({ cookie, path: `/u/${target.username}` });
  try {
    console.log("[A] 个人主页入口");
    const btn = await waitFor(
      () =>
        cdp.evaluate(
          `[...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("打赏作者")) ? 1 : 0`,
        ),
      (v) => v === 1,
      25000,
    );
    ok("页面出现「打赏作者」按钮", btn === 1);

    console.log("\n[B] 打开面板");
    await cdp.evaluate(
      `[...document.querySelectorAll("button")].find(b => (b.textContent||"").includes("打赏作者")).click()`,
    );
    const dlg = await waitFor(
      () => cdp.evaluate(`!!document.querySelector('[role="dialog"]')`),
      (v) => v === true,
      10000,
    );
    ok("打赏面板打开", dlg === true);
    const title = await cdp.evaluate(
      `document.querySelector('[role="dialog"] h2')?.textContent ?? ""`,
    );
    ok("面板标题带对方用户名", title.includes(`@${target.username}`), title);
    const note = await cdp.evaluate(
      `document.querySelector('[role="dialog"] p')?.textContent ?? ""`,
    );
    ok("面板说明提到全数归对方", note.includes(target.username) && note.includes("不抽成"), note.slice(0, 40));

    console.log("\n[C] 提交（默认档位）");
    const amount = await cdp.evaluate(
      `Number(document.querySelector('[role="dialog"] input[type=number]').value)`,
    );
    ok("金额在合法区间内", Number.isInteger(amount) && amount > 0, `${amount}`);
    await cdp.evaluate(
      `[...document.querySelectorAll('[role="dialog"] button')].filter(b => (b.textContent||"").startsWith("打赏 ")).pop().click()`,
    );
    const toastText = await waitFor(
      () =>
        cdp.evaluate(
          `(() => { const t = document.querySelector('[role="status"]'); return t ? t.textContent : ""; })()`,
        ),
      (v) => typeof v === "string" && v.includes("已打赏"),
      15000,
    );
    ok("出现成功 toast", String(toastText ?? "").includes("已打赏"), String(toastText ?? "(无)"));
    const closed = await waitFor(
      () => cdp.evaluate(`!!document.querySelector('[role="dialog"]')`),
      (v) => v === false,
      8000,
    );
    ok("成功后面板自动关闭", closed === false);
  } finally {
    await dispose();
  }

  console.log("\n[D] 落账");
  const after = {
    from: await balanceOf(viewer.id),
    to: await balanceOf(target.id),
    tips: await prisma.tipRecord.count({ where: { fromUserId: viewer.id, resourceId: null } }),
  };
  const tip = await prisma.tipRecord.findFirst({
    where: { fromUserId: viewer.id, toUserId: target.id, resourceId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, coin: true },
  });
  ok("TipRecord 落库且 resourceId 为空（作者维度）", !!tip, tip ? `coin=${tip.coin}` : "");
  ok("发出方余额减少", after.from < before.from, `${before.from} → ${after.from}`);
  ok("收款方余额增加", after.to > before.to, `${before.to} → ${after.to}`);
  ok(
    "站内 PIX 总量不变（转入=转出）",
    before.from + before.to === after.from + after.to,
    `${before.from + before.to} → ${after.from + after.to}`,
  );
  ok("打赏条数 +1", after.tips === before.tips + 1, `${before.tips} → ${after.tips}`);
  const ledgers = tip
    ? await prisma.coinLedger.findMany({
        where: { refType: "TIP", refId: { startsWith: "tip:" }, userId: { in: [viewer.id, target.id] } },
        select: { userId: true, kind: true, delta: true },
        orderBy: { createdAt: "desc" },
        take: 2,
      })
    : [];
  ok(
    "两条流水（TIP_SENT −N / TIP_RECEIVED +N）",
    ledgers.length === 2 &&
      ledgers.some((l) => l.userId === viewer.id && l.kind === "TIP_SENT" && l.delta === -(tip?.coin ?? 0)) &&
      ledgers.some((l) => l.userId === target.id && l.kind === "TIP_RECEIVED" && l.delta === tip?.coin),
    ledgers.map((l) => `${l.kind}:${l.delta}`).join(" "),
  );

  console.log(`\n合计 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e?.stack ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
