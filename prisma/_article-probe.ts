// 临时探针：ARTICLE 详情页（article 模板）是否渲染出打赏入口（用完即删）
// 库里没有已发布文章，临时造一条 → 验证 → finally 里删掉（含失败路径）
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encode } from "@auth/core/jwt";

const ROOT = "E:/project/pixel_hub";
const BASE = "http://localhost:3000";
const SLUG = "_tmp-tip-article-probe";
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

async function main() {
  loadEnv();
  await prisma.resource.deleteMany({ where: { slug: SLUG } });
  const author = await prisma.user.findFirst({
    where: { role: "USER", username: { not: "edittest" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true },
  });
  const viewer = await prisma.user.findFirst({
    where: { id: { not: author!.id } },
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, role: true },
  });
  await prisma.resource.create({
    data: {
      slug: SLUG,
      title: "临时探针文章",
      description: "用于验证 article 模板的打赏入口，用完即删。",
      type: "ARTICLE",
      authorId: author!.id,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const cookie = await encode({
    token: { id: viewer!.id, username: viewer!.username, role: viewer!.role },
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
  });
  const res = await fetch(`${BASE}/resources/${SLUG}`, {
    headers: { cookie: `authjs.session-token=${cookie}` },
    redirect: "manual",
  });
  const html = res.status === 200 ? await res.text() : "";
  const n = (s: string) => html.split(s).length - 1;
  console.log(
    `article 模板 author=${author!.username} viewer=${viewer!.username} status=${res.status} 打赏作者×${n("打赏作者")} 打赏总×${n("打赏")}`,
  );
}

main()
  .catch((e) => console.error(e?.stack ?? e))
  .finally(async () => {
    await prisma.resource.deleteMany({ where: { slug: SLUG } });
    await prisma.$disconnect();
  });
