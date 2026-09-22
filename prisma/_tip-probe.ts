// 临时探针：作者维度打赏「打赏作者」是否出现在详情页四模板与个人主页（用完即删）
// 关键：观赏者必须是非作者，否则打赏入口按设计隐藏（自己不给自己的内容打赏）
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encode } from "@auth/core/jwt";

const ROOT = "E:/project/pixel_hub";
const BASE = "http://localhost:3000";
const prisma = new PrismaClient();

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

async function get(url: string, cookie?: string) {
  const res = await fetch(url, {
    headers: cookie ? { cookie: `authjs.session-token=${cookie}` } : {},
    redirect: "manual",
  });
  const html = res.status === 200 ? await res.text() : "";
  return { status: res.status, html };
}

const count = (html: string, needle: string) => (html.split(needle).length - 1);

async function main() {
  loadEnv();
  const secret = process.env.AUTH_SECRET!;
  const viewer = await prisma.user.findFirst({
    where: { role: "USER", username: { not: "maplene" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, role: true },
  });
  if (!viewer) throw new Error("找不到非管理员用户");
  console.log(`viewer: ${viewer.username} (${viewer.role})\n`);
  const cookie = await encode({
    token: { id: viewer.id, username: viewer.username, role: viewer.role },
    secret,
    salt: "authjs.session-token",
  });

  console.log("== 详情页（按类型，取 4 个模板各自对应的类型）==");
  for (const t of ["IMAGE", "ARTICLE", "MUSIC", "VIDEO", "GAME"] as const) {
    const r = await prisma.resource.findFirst({
      where: { type: t, status: "PUBLISHED", authorId: { not: viewer.id } },
      orderBy: { createdAt: "desc" },
      select: { slug: true, author: { select: { username: true } } },
    });
    if (!r) {
      console.log(`${t.padEnd(8)} 无可用资源`);
      continue;
    }
    const { status, html } = await get(`${BASE}/resources/${r.slug}`, cookie);
    console.log(
      `${t.padEnd(8)} ${String(status).padEnd(4)} 打赏作者×${String(count(html, "打赏作者")).padEnd(2)} 打赏总×${String(count(html, "打赏")).padEnd(2)} author=${r.author.username}`,
    );
  }

  console.log("\n== 个人主页 ==");
  const author = await prisma.user.findFirst({
    where: { id: { not: viewer.id }, resources: { some: { status: "PUBLISHED" } } },
    select: { username: true },
  });
  if (author) {
    const a = await get(`${BASE}/u/${author.username}`, cookie);
    const b = await get(`${BASE}/u/${author.username}`);
    console.log(`他人主页 /u/${author.username}  登录:打赏作者×${count(a.html, "打赏作者")}  未登录:×${count(b.html, "打赏作者")}`);
  }
  const self = await get(`${BASE}/u/${viewer.username}`, cookie);
  console.log(`本人主页 /u/${viewer.username}  打赏作者×${count(self.html, "打赏作者")} (期望 0)`);
}

main()
  .catch((e) => console.error(e?.stack ?? e))
  .finally(() => prisma.$disconnect());
