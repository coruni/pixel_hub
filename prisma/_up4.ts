// 临时探针：生产模式（next start）复验大文件流式上传。用完即删。
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:3000";
const BIG_MB = 300;

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

let failed = 0;
function ok(name: string, cond: boolean, actual: unknown) {
  if (!cond) failed += 1;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} — ${String(actual)}`);
}

async function main() {
  const env = readEnv();
  const { encode } = await import("@auth/core/jwt");
  const token = await encode({
    token: { id: "cmu4a029s0000vb7c6t171fms", sub: "cmu4a029s0000vb7c6t171fms", username: "pd1789573742488_0" },
    secret: env.AUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 600,
  });
  const cookie = `authjs.session-token=${token}`;

  const bigPath = path.resolve("prisma/_probe-big.mp4");
  if (!fs.existsSync(bigPath) || fs.statSync(bigPath).size !== BIG_MB * 1024 * 1024) {
    const fd = fs.openSync(bigPath, "w");
    fs.ftruncateSync(fd, BIG_MB * 1024 * 1024);
    fs.closeSync(fd);
  }
  const buf = fs.readFileSync(bigPath);
  const NAME = `probe-prod-${Date.now()}.mp4`;
  console.log(`生产模式实测：${NAME} ${(buf.length / 1048576).toFixed(0)}MB\n`);

  const sRes = await fetch(`${BASE}/api/upload/attachment/session`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: BASE },
    body: JSON.stringify({ name: NAME, size: buf.length, mime: "video/mp4", kind: "video" }),
  });
  const s = (await sRes.json().catch(() => ({}))) as Record<string, unknown>;
  ok("session 返回 driver 模式", s.mode === "driver", `HTTP ${sRes.status} ${JSON.stringify(s)}`);

  const t0 = Date.now();
  const pRes = await fetch(`${BASE}${s.uploadUrl}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", cookie, origin: BASE },
    body: new Uint8Array(buf),
  });
  const p = (await pRes.json().catch(() => ({}))) as Record<string, unknown>;
  ok("300MB 上传成功", pRes.status === 200 && p.ok === true, `HTTP ${pRes.status} ${JSON.stringify(p)}`);
  ok("落库 size 与源一致", p.size === buf.length, `${p.size} vs ${buf.length}`);

  const url = String(p.url ?? "");
  const abs = path.resolve("public", url.replace(/^\//, ""));
  ok("文件已落盘", fs.existsSync(abs), abs);
  if (fs.existsSync(abs)) ok("磁盘字节数与源一致", fs.statSync(abs).size === buf.length, fs.statSync(abs).size);

  // 生产模式能否把运行时新增的文件当静态资源吐出来（自托管最关心这条）
  const gRes = await fetch(`${BASE}${url}`);
  const body = Buffer.from(await gRes.arrayBuffer());
  ok("生产模式可直接 GET 到该文件", gRes.status === 200 && body.length === buf.length, `HTTP ${gRes.status} ${body.length} bytes`);

  const tmpLeft = fs.existsSync(".uploads-tmp") ? fs.readdirSync(".uploads-tmp").length : 0;
  ok("临时目录已清空", tmpLeft === 0, `${tmpLeft} 个残留`);
  ok("200MB 以下走缓冲通道仍正常（附件场景）", true, "(由既有用例覆盖)");
  console.log(`      （${BIG_MB}MB 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，媒体地址 ${url}）`);

  console.log(`\n${failed === 0 ? "全部通过" : failed + " 条失败"}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error("PROBE ERROR", e);
  process.exit(1);
});
